import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const QBankScreen = () => {
  const [searchText, setSearchText] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('all');

  const subjects = [
    { id: 'math', name: 'Mathematics', icon: 'calculate', color: '#3b82f6', count: 245 },
    { id: 'physics', name: 'Physics', icon: 'science', color: '#10b981', count: 189 },
    { id: 'chemistry', name: 'Chemistry', icon: 'biotech', color: '#f59e0b', count: 167 },
    { id: 'biology', name: 'Biology', icon: 'eco', color: '#ef4444', count: 203 },
  ];

  const chapters = [
    { id: 1, subject: 'math', title: 'Algebra', questions: 45, completed: 32 },
    { id: 2, subject: 'math', title: 'Geometry', questions: 38, completed: 28 },
    { id: 3, subject: 'physics', title: 'Mechanics', questions: 52, completed: 41 },
    { id: 4, subject: 'physics', title: 'Electricity', questions: 47, completed: 35 },
    { id: 5, subject: 'chemistry', title: 'Organic Chemistry', questions: 41, completed: 30 },
    { id: 6, subject: 'biology', title: 'Cell Biology', questions: 39, completed: 25 },
  ];

  const filteredChapters = selectedSubject === 'all' 
    ? chapters 
    : chapters.filter(ch => ch.subject === selectedSubject);

  const renderSubject = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.subjectCard,
        selectedSubject === item.id && styles.subjectCardSelected
      ]}
      onPress={() => setSelectedSubject(item.id)}
    >
      <View style={[styles.iconContainer, { backgroundColor: item.color }]}>
        <Icon name={item.icon} size={24} color="#ffffff" />
      </View>
      <Text style={styles.subjectName}>{item.name}</Text>
      <Text style={styles.questionCount}>{item.count} questions</Text>
    </TouchableOpacity>
  );

  const renderChapter = ({ item }) => (
    <TouchableOpacity style={styles.chapterCard}>
      <View style={styles.chapterHeader}>
        <Text style={styles.chapterTitle}>{item.title}</Text>
        <View style={styles.progressContainer}>
          <Text style={styles.progressText}>
            {item.completed}/{item.questions}
          </Text>
        </View>
      </View>
      <View style={styles.progressBar}>
        <View 
          style={[
            styles.progressFill, 
            { width: `${(item.completed / item.questions) * 100}%` }
          ]} 
        />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a3a3a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Question Bank</Text>
        <TouchableOpacity style={styles.filterButton}>
          <Icon name="filter-list" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={20} color="#6b7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search questions, topics..."
          placeholderTextColor="#6b7280"
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>

      {/* Subjects */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Subjects</Text>
        <FlatList
          data={subjects}
          renderItem={renderSubject}
          keyExtractor={item => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subjectsList}
        />
      </View>

      {/* Chapters */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chapters</Text>
        <FlatList
          data={filteredChapters}
          renderItem={renderChapter}
          keyExtractor={item => item.id.toString()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.chaptersList}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3a3a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  filterButton: {
    padding: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d5a5a',
    marginHorizontal: 20,
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#ffffff',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginHorizontal: 20,
    marginBottom: 12,
  },
  subjectsList: {
    paddingLeft: 20,
    paddingRight: 10,
  },
  subjectCard: {
    alignItems: 'center',
    backgroundColor: '#2d5a5a',
    padding: 16,
    borderRadius: 12,
    marginRight: 12,
    minWidth: 100,
  },
  subjectCardSelected: {
    backgroundColor: '#3b82f6',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  subjectName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  questionCount: {
    fontSize: 12,
    color: '#a0aec0',
    textAlign: 'center',
  },
  chaptersList: {
    paddingHorizontal: 20,
  },
  chapterCard: {
    backgroundColor: '#2d5a5a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  chapterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chapterTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
  },
  progressContainer: {
    backgroundColor: '#1a3a3a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  progressText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '600',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#1a3a3a',
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 2,
  },
});

export default QBankScreen;
