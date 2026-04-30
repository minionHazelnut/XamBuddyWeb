#!/usr/bin/env python3
"""
split_pdf.py — Split a textbook PDF into chapter-wise PDFs and zip them.

Detects chapter starts by looking for visually prominent text (large or bold font)
in the top half of a page. Ignores everything before the first detected chapter.

Usage:
    python scripts/split_pdf.py "class 8 eng maths-part 1.pdf"
    python scripts/split_pdf.py "class 8 eng maths-part 2.pdf" --start-chapter 7

Arguments:
    pdf               Path to the input PDF
    --start-chapter   Chapter number to start from (default: 1).
                      Use this for part-2 PDFs — if part-1 ended at chapter 6,
                      pass --start-chapter 7.
    --threshold       Font-size multiplier for chapter detection (default: 1.4).
                      Increase (e.g. 1.6) if too many false positives are detected.
                      Decrease (e.g. 1.2) if chapters are being missed.
    --out-dir         Where to save the ZIP (default: same folder as the PDF).
"""

import argparse
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF — already a dependency of main.py


# ---------------------------------------------------------------------------
# Subject name extraction
# ---------------------------------------------------------------------------

def extract_subject_name(filename: str) -> str:
    """
    'class 8 eng maths-part 1.pdf' -> 'maths part 1'
    Strips the 'class N lang ' prefix and normalises hyphens/underscores.
    """
    stem = Path(filename).stem
    # Remove 'class <number> <word> ' prefix (e.g. 'class 8 eng ')
    cleaned = re.sub(r'^class\s+\d+\s+\w+\s+', '', stem, flags=re.IGNORECASE).strip()
    if not cleaned:
        cleaned = stem  # fallback: use the full stem as-is
    # Normalise separators
    cleaned = re.sub(r'[-_]+', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


# ---------------------------------------------------------------------------
# Font analysis
# ---------------------------------------------------------------------------

def detect_body_font_size(doc: fitz.Document) -> float:
    """
    Estimate the body (most common) font size by sampling the first 30 pages
    weighted by the number of characters at each size.
    """
    size_weight: Counter = Counter()
    sample = min(len(doc), 30)
    for page_idx in range(sample):
        for block in doc[page_idx].get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    chars = len(span["text"].strip())
                    if chars > 0:
                        size_weight[round(span["size"], 1)] += chars
    if not size_weight:
        return 12.0
    return size_weight.most_common(1)[0][0]


# ---------------------------------------------------------------------------
# Chapter detection
# ---------------------------------------------------------------------------

_CHAPTER_PREFIX = re.compile(
    r'^(chapter|ch\.?|unit|section|part)\s*[\d\w]+\.?\s*',
    re.IGNORECASE,
)
_WATERMARK_RE = re.compile(
    r'@\S+\s+NOT\s+TO\s+BE\s+\w+',
    re.IGNORECASE,
)
_FRONT_MATTER_RE = re.compile(
    r'^(foreword|preface|contents|table\s+of\s+contents|constitution.*|about\s+(this\s+)?book|index|acknowledgements?|note\s+to\s+(teachers?|students?)|introduction)$',
    re.IGNORECASE,
)


def _clean_title(raw: str) -> str:
    """
    Remove watermarks and redundant 'Chapter N' prefix so the chapter name itself remains.
    'Chapter 1 Real Numbers' -> 'Real Numbers'
    If nothing remains after stripping, return the original.
    """
    raw = _WATERMARK_RE.sub('', raw).strip()
    cleaned = _CHAPTER_PREFIX.sub('', raw).strip()
    # Collapse internal whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned if cleaned else raw.strip()


def _has_letters(text: str) -> bool:
    return any(c.isalpha() for c in text)


def page_chapter_title(
    page: fitz.Page,
    body_size: float,
    threshold_multiplier: float,
) -> Optional[str]:
    """
    Return the chapter title if this page starts a new chapter, else None.

    Detection criteria:
    - Text must be in the top 65% of the page.
    - Font size >= body_size * threshold_multiplier, OR bold with size >= body_size * 1.1.
    - Spans containing only decorative/symbol characters (no letters) are ignored.
    - At least 2 characters must be present.
    """
    top_region_y = page.rect.height * 0.65
    min_size = body_size * threshold_multiplier
    bold_min_size = body_size * 1.1

    title_parts: list[str] = []
    found_prominent = False

    blocks = sorted(
        page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"],
        key=lambda b: b.get("bbox", [0, 0, 0, 0])[1],
    )

    for block in blocks:
        if block["type"] != 0:
            continue
        block_top_y = block.get("bbox", [0, 0, 0, 0])[1]
        if block_top_y > top_region_y:
            break

        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span["text"].strip()
                if not text:
                    continue
                size = span["size"]
                is_bold = bool(span["flags"] & 16)

                if size >= min_size or (is_bold and size >= bold_min_size):
                    clean = _WATERMARK_RE.sub('', text).strip()
                    # Skip decorative font characters — real titles contain letters
                    if clean and _has_letters(clean):
                        title_parts.append(clean)
                    found_prominent = True

    if not found_prominent or not title_parts:
        return None

    raw = " ".join(title_parts).strip()
    if len(raw) < 2:
        return None

    return _clean_title(raw)


def find_chapters(
    doc: fitz.Document,
    body_size: float,
    threshold_multiplier: float,
) -> list[tuple[int, str]]:
    """
    Return [(page_index, chapter_title), ...] for every detected chapter start.
    Consecutive detections within 1 page of each other are merged (title continuation).
    """
    raw_hits: list[tuple[int, str]] = []
    for page_idx in range(len(doc)):
        title = page_chapter_title(doc[page_idx], body_size, threshold_multiplier)
        if title:
            raw_hits.append((page_idx, title))

    # Discard repeated headers and front-matter pages
    title_counts: Counter = Counter(t for _, t in raw_hits)
    raw_hits = [
        (p, t) for p, t in raw_hits
        if title_counts[t] < 3
        and not t.startswith('@')
        and not _FRONT_MATTER_RE.match(t.strip())
    ]

    # Merge consecutive pages that are likely part of the same chapter heading
    merged: list[tuple[int, str]] = []
    for page_idx, title in raw_hits:
        if merged and page_idx - merged[-1][0] <= 1:
            # Combine with the previous hit (keep the longer/more descriptive title)
            prev_idx, prev_title = merged[-1]
            combined = (prev_title + " " + title).strip() if prev_title not in title else prev_title
            merged[-1] = (prev_idx, combined)
        else:
            merged.append((page_idx, title))

    return merged


# ---------------------------------------------------------------------------
# Filename sanitisation
# ---------------------------------------------------------------------------

def safe_filename(name: str) -> str:
    """Remove characters not allowed in filenames across platforms."""
    return re.sub(r'[\\/*?:"<>|\n\r\t]+', '', name).strip()


# ---------------------------------------------------------------------------
# Main split + zip
# ---------------------------------------------------------------------------

def split_and_zip(
    pdf_path: str,
    start_chapter: int = 1,
    threshold_multiplier: float = 1.4,
    out_dir: Optional[str] = None,
) -> None:
    src = Path(pdf_path)
    if not src.exists():
        print(f"Error: file not found: {src}")
        sys.exit(1)

    subject_name = extract_subject_name(src.name)
    print(f"\nSubject name (folder): '{subject_name}'")

    doc = fitz.open(str(src))
    total_pages = len(doc)
    print(f"PDF pages          : {total_pages}")

    body_size = detect_body_font_size(doc)
    print(f"Body font size     : {body_size}pt")
    print(f"Chapter threshold  : >={round(body_size * threshold_multiplier, 1)}pt "
          f"(multiplier {threshold_multiplier})\n")

    chapters = find_chapters(doc, body_size, threshold_multiplier)

    if not chapters:
        print(
            "No chapters detected.\n"
            "Try lowering --threshold (e.g. --threshold 1.2) if the headings "
            "are not much larger than the body text."
        )
        sys.exit(1)

    print(f"Detected {len(chapters)} chapter(s):\n")
    for i, (page_idx, title) in enumerate(chapters):
        num = start_chapter + i
        end_page = chapters[i + 1][0] if i + 1 < len(chapters) else total_pages
        pages = end_page - page_idx
        print(f"  {num:>2}. {title}")
        print(f"      Pages {page_idx + 1}–{end_page}  ({pages} page{'s' if pages != 1 else ''})")

    print()
    confirm = input("Proceed with this split? [y/N]: ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        sys.exit(0)

    # Output ZIP path
    dest_dir = Path(out_dir) if out_dir else src.parent
    dest_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dest_dir / f"{safe_filename(subject_name)}.zip"

    print(f"\nBuilding ZIP: {zip_path}\n")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, (start_page, title) in enumerate(chapters):
            chapter_num = start_chapter + i
            end_page = chapters[i + 1][0] if i + 1 < len(chapters) else total_pages

            chapter_title_safe = safe_filename(title)
            pdf_filename = f"{chapter_num}. {chapter_title_safe}.pdf"
            zip_entry = f"{subject_name}/{pdf_filename}"

            # Extract chapter pages into an in-memory PDF
            chapter_doc = fitz.open()
            chapter_doc.insert_pdf(doc, from_page=start_page, to_page=end_page - 1)
            pdf_bytes = chapter_doc.tobytes(deflate=True)
            chapter_doc.close()

            zf.writestr(zip_entry, pdf_bytes)
            pages = end_page - start_page
            print(f"  + {pdf_filename}  ({pages} page{'s' if pages != 1 else ''})")

    doc.close()
    print(f"\nDone!  ZIP saved to: {zip_path}")
    print(
        f"\nWhen uploading to bulk generation:\n"
        f"  subject  = '{subject_name}'\n"
        f"  chapter  = filename without '.pdf'  (e.g. '{start_chapter}. {chapters[0][1]}')"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split a textbook PDF into chapter PDFs and package as a ZIP.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("pdf", help="Path to the input PDF file")
    parser.add_argument(
        "--start-chapter", type=int, default=1, metavar="N",
        help="Chapter number to start from (default: 1). Use 7 if part-1 had 6 chapters.",
    )
    parser.add_argument(
        "--threshold", type=float, default=1.4, metavar="MULTIPLIER",
        help="Font-size multiplier for chapter heading detection (default: 1.4).",
    )
    parser.add_argument(
        "--out-dir", default=None, metavar="DIR",
        help="Directory to save the ZIP (default: same folder as the PDF).",
    )
    args = parser.parse_args()

    split_and_zip(
        pdf_path=args.pdf,
        start_chapter=args.start_chapter,
        threshold_multiplier=args.threshold,
        out_dir=args.out_dir,
    )


if __name__ == "__main__":
    main()
