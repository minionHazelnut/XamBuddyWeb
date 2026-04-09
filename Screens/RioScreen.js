import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const RioScreen = () => {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'bot',
      text: 'Hello! I\'m Rio, your AI study assistant. How can I help you today?',
      timestamp: '10:30 AM'
    },
    {
      id: 2,
      type: 'user',
      text: 'Can you explain the concept of photosynthesis?',
      timestamp: '10:32 AM'
    },
    {
      id: 3,
      type: 'bot',
      text: 'Photosynthesis is the process by which plants convert light energy into chemical energy. It involves chlorophyll capturing sunlight and using it to convert CO2 and water into glucose and oxygen. This process is fundamental to life on Earth as it produces the oxygen we breathe.',
      timestamp: '10:33 AM'
    }
  ]);

  const helpTopics = [
    { id: 1, title: 'Explain Concepts', icon: 'lightbulb', color: '#3b82f6' },
    { id: 2, title: 'Practice Problems', icon: 'assignment', color: '#10b981' },
    { id: 3, title: 'Study Tips', icon: 'psychology', color: '#f59e0b' },
    { id: 4, title: 'Exam Prep', icon: 'event', color: '#ef4444' },
    { id: 5, title: 'Doubt Clearing', icon: 'help', color: '#8b5cf6' },
    { id: 6, title: 'Revision', icon: 'replay', color: '#06b6d4' },
  ];

  const sendMessage = () => {
    if (message.trim()) {
      const newMessage = {
        id: messages.length + 1,
        type: 'user',
        text: message.trim(),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      setMessages([...messages, newMessage]);
      setMessage('');
      
      // Simulate bot response
      setTimeout(() => {
        const botResponse = {
          id: messages.length + 2,
          type: 'bot',
          text: 'I\'m processing your question. This is a demo response - in the real app, I would provide a detailed answer based on your query.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, botResponse]);
      }, 1000);
    }
  };

  const renderMessage = ({ item }) => (
    <View style={[
      styles.messageContainer,
      item.type === 'user' ? styles.userMessage : styles.botMessage
    ]}>
      <View style={[
        styles.messageBubble,
        item.type === 'user' ? styles.userBubble : styles.botBubble
      ]}>
        <Text style={[
          styles.messageText,
          item.type === 'user' ? styles.userText : styles.botText
        ]}>
          {item.text}
        </Text>
      </View>
      <Text style={styles.timestamp}>{item.timestamp}</Text>
    </View>
  );

  const renderHelpTopic = ({ item }) => (
    <TouchableOpacity style={styles.helpTopicCard}>
      <View style={[styles.helpIcon, { backgroundColor: item.color }]}>
        <Icon name={item.icon} size={20} color="#ffffff" />
      </View>
      <Text style={styles.helpTopicTitle}>{item.title}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a3a3a" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.rioIcon}>
            <Icon name="auto-awesome" size={24} color="#ffffff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Rio</Text>
            <Text style={styles.headerSubtitle}>AI Study Assistant</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.clearButton}>
          <Icon name="clear-all" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Help Topics */}
      <View style={styles.helpTopicsSection}>
        <Text style={styles.sectionTitle}>How can I help?</Text>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.helpTopicsList}
        >
          {helpTopics.map(renderHelpTopic)}
        </ScrollView>
      </View>

      {/* Chat Messages */}
      <ScrollView 
        style={styles.messagesContainer}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.messagesList}
      >
        {messages.map(renderMessage)}
      </ScrollView>

      {/* Input Area */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inputContainer}
      >
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.textInput}
            placeholder="Ask me anything about your studies..."
            placeholderTextColor="#6b7280"
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={500}
          />
          <TouchableOpacity 
            style={[
              styles.sendButton,
              message.trim() ? styles.sendButtonActive : {}
            ]}
            onPress={sendMessage}
            disabled={!message.trim()}
          >
            <Icon 
              name="send" 
              size={20} 
              color={message.trim() ? "#ffffff" : "#6b7280"} 
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a5a',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rioIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#a0aec0',
  },
  clearButton: {
    padding: 8,
  },
  helpTopicsSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2d5a5a',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  helpTopicsList: {
    paddingRight: 10,
  },
  helpTopicCard: {
    alignItems: 'center',
    backgroundColor: '#2d5a5a',
    padding: 12,
    borderRadius: 12,
    marginRight: 12,
    minWidth: 80,
  },
  helpIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  helpTopicTitle: {
    fontSize: 12,
    color: '#ffffff',
    textAlign: 'center',
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  messagesList: {
    paddingVertical: 16,
  },
  messageContainer: {
    marginBottom: 16,
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  botMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    marginBottom: 4,
  },
  userBubble: {
    backgroundColor: '#3b82f6',
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: '#2d5a5a',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: '#ffffff',
  },
  botText: {
    color: '#ffffff',
  },
  timestamp: {
    fontSize: 11,
    color: '#6b7280',
    paddingHorizontal: 4,
  },
  inputContainer: {
    backgroundColor: '#1a3a3a',
    borderTopWidth: 1,
    borderTopColor: '#2d5a5a',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#2d5a5a',
    color: '#ffffff',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    marginRight: 12,
    maxHeight: 100,
    borderTopRightRadius: 20,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2d5a5a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: '#3b82f6',
  },
});

export default RioScreen;
