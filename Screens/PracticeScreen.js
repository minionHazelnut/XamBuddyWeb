import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const PracticeScreen = () => {
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('medium');
  const [selectedQuestionType, setSelectedQuestionType] = useState('mcq');

  const subjects = [
    { id: 'math', name: 'Mathematics', icon: 'calculate', color: '#3b82f6' },
    { id: 'physics', name: 'Physics', icon: 'science', color: '#10b981' },
    { id: 'chemistry', name: 'Chemistry', icon: 'biotech', color: '#f59e0b' },
    { id: 'biology', name: 'Biology', icon: 'eco', color: '#ef4444' },
  ];

  const difficulties = [
    { id: 'easy', name: 'Easy', color: '#10b981', description: 'Basic concepts' },
    { id: 'medium', name: 'Medium', color: '#f59e0b', description: 'Intermediate level' },
    { id: 'hard', name: 'Hard', color: '#ef4444', description: 'Advanced problems' },
  ];

  const questionTypes = [
    { id: 'mcq', name: 'Multiple Choice', icon: 'radio-button-checked', description: 'Choose correct answer' },
    { id: 'short', name: 'Short Answer', icon: 'short-text', description: 'Brief responses' },
    { id: 'long', name: 'Long Answer', icon: 'description', description: 'Detailed explanations' },
  ];

  const renderSubject = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.subjectCard,
        selectedSubject === item.id && styles.selectedCard
      ]}
      onPress={() => setSelectedSubject(item.id)}
    >
      <View style={[styles.iconContainer, { backgroundColor: item.color }]}>
        <Icon name={item.icon} size={28} color="#ffffff" />
      </View>
      <Text style={styles.subjectName}>{item.name}</Text>
    </TouchableOpacity>
  );

  const renderDifficulty = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.optionCard,
        selectedDifficulty === item.id && styles.selectedCard
      ]}
      onPress={() => setSelectedDifficulty(item.id)}
    >
      <View style={[styles.difficultyIndicator, { backgroundColor: item.color }]} />
      <View style={styles.optionContent}>
        <Text style={styles.optionTitle}>{item.name}</Text>
        <Text style={styles.optionDescription}>{item.description}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderQuestionType = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.optionCard,
        selectedQuestionType === item.id && styles.selectedCard
      ]}
      onPress={() => setSelectedQuestionType(item.id)}
    >
      <Icon name={item.icon} size={24} color="#a0aec0" style={styles.optionIcon} />
      <View style={styles.optionContent}>
        <Text style={styles.optionTitle}>{item.name}</Text>
        <Text style={styles.optionDescription}>{item.description}</Text>
      </View>
    </TouchableOpacity>
  );

  const canStartPractice = selectedSubject && selectedDifficulty && selectedQuestionType;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a3a3a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Practice</Text>
        <TouchableOpacity style={styles.historyButton}>
          <Icon name="history" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Subject Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Subject</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subjectsList}
          >
            {subjects.map(renderSubject)}
          </ScrollView>
        </View>

        {/* Difficulty Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Difficulty Level</Text>
          {difficulties.map(renderDifficulty)}
        </View>

        {/* Question Type Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Question Type</Text>
          {questionTypes.map(renderQuestionType)}
        </View>

        {/* Start Practice Button */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[
              styles.startButton,
              canStartPractice && styles.startButtonActive
            ]}
            disabled={!canStartPractice}
          >
            <Text style={[
              styles.startButtonText,
              canStartPractice && styles.startButtonTextActive
            ]}>
              Start Practice
            </Text>
            <Icon 
              name="arrow-forward" 
              size={20} 
              color={canStartPractice ? "#ffffff" : "#6b7280"} 
            />
          </TouchableOpacity>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>1,247</Text>
            <Text style={styles.statLabel}>Questions Completed</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>89%</Text>
            <Text style={styles.statLabel}>Accuracy Rate</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>15</Text>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
        </View>
      </ScrollView>
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
  historyButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  subjectsList: {
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
  selectedCard: {
    backgroundColor: '#3b82f6',
    borderWidth: 2,
    borderColor: '#60a5fa',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  subjectName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d5a5a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  difficultyIndicator: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 16,
  },
  optionIcon: {
    marginRight: 16,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 14,
    color: '#a0aec0',
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2d5a5a',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  startButtonActive: {
    backgroundColor: '#3b82f6',
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6b7280',
    marginRight: 8,
  },
  startButtonTextActive: {
    color: '#ffffff',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#2d5a5a',
    paddingVertical: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#a0aec0',
    textAlign: 'center',
  },
});

export default PracticeScreen;
