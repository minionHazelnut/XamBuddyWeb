import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Switch,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const ProfileScreen = () => {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);

  const user = {
    name: 'Alex Johnson',
    email: 'alex.johnson@email.com',
    grade: 'Class 10',
    school: 'Delhi Public School',
    avatar: null, // Would be actual image URI
    joinDate: 'January 2024',
    studyStreak: 15,
    totalQuestions: 1247,
    accuracy: 89,
  };

  const menuItems = [
    {
      id: 'progress',
      title: 'My Progress',
      icon: 'trending-up',
      color: '#3b82f6',
      subtitle: 'View detailed analytics'
    },
    {
      id: 'achievements',
      title: 'Achievements',
      icon: 'emoji-events',
      color: '#f59e0b',
      subtitle: '12 badges earned'
    },
    {
      id: 'study-history',
      title: 'Study History',
      icon: 'history',
      color: '#10b981',
      subtitle: 'Track your learning journey'
    },
    {
      id: 'bookmarks',
      title: 'Bookmarks',
      icon: 'bookmark',
      color: '#ef4444',
      subtitle: 'Save important questions'
    },
    {
      id: 'settings',
      title: 'Settings',
      icon: 'settings',
      color: '#6b7280',
      subtitle: 'App preferences'
    },
    {
      id: 'help',
      title: 'Help & Support',
      icon: 'help',
      color: '#8b5cf6',
      subtitle: 'Get assistance'
    },
    {
      id: 'about',
      title: 'About',
      icon: 'info',
      color: '#06b6d4',
      subtitle: 'App version 1.0.0'
    },
  ];

  const renderMenuItem = ({ item }) => (
    <TouchableOpacity style={styles.menuItem}>
      <View style={[styles.menuIcon, { backgroundColor: item.color }]}>
        <Icon name={item.icon} size={24} color="#ffffff" />
      </View>
      <View style={styles.menuContent}>
        <Text style={styles.menuTitle}>{item.title}</Text>
        <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={24} color="#6b7280" />
    </TouchableOpacity>
  );

  const renderSettingItem = ({ title, value, onToggle }) => (
    <View style={styles.settingItem}>
      <Text style={styles.settingTitle}>{title}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#2d5a5a', true: '#3b82f6' }}
        thumbColor={value ? '#ffffff' : '#6b7280'}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a3a3a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity style={styles.editButton}>
          <Icon name="edit" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            {user.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {user.name.split(' ').map(n => n[0]).join('')}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          <View style={styles.userDetails}>
            <View style={styles.detailItem}>
              <Icon name="school" size={16} color="#a0aec0" />
              <Text style={styles.detailText}>{user.grade}</Text>
            </View>
            <View style={styles.detailItem}>
              <Icon name="business" size={16} color="#a0aec0" />
              <Text style={styles.detailText}>{user.school}</Text>
            </View>
            <View style={styles.detailItem}>
              <Icon name="calendar-today" size={16} color="#a0aec0" />
              <Text style={styles.detailText}>Joined {user.joinDate}</Text>
            </View>
          </View>
        </View>

        {/* Stats Card */}
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Your Stats</Text>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{user.studyStreak}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{user.totalQuestions}</Text>
              <Text style={styles.statLabel}>Questions</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{user.accuracy}%</Text>
              <Text style={styles.statLabel}>Accuracy</Text>
            </View>
          </View>
        </View>

        {/* Quick Settings */}
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Quick Settings</Text>
          {renderSettingItem({
            title: 'Push Notifications',
            value: notifications,
            onToggle: setNotifications
          })}
          {renderSettingItem({
            title: 'Dark Mode',
            value: darkMode,
            onToggle: setDarkMode
          })}
          {renderSettingItem({
            title: 'Auto-play Videos',
            value: autoPlay,
            onToggle: setAutoPlay
          })}
        </View>

        {/* Menu Items */}
        <View style={styles.menuCard}>
          {menuItems.map(renderMenuItem)}
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton}>
          <Icon name="logout" size={24} color="#ef4444" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
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
  editButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  profileCard: {
    backgroundColor: '#2d5a5a',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#a0aec0',
    marginBottom: 16,
  },
  userDetails: {
    width: '100%',
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#ffffff',
    marginLeft: 8,
  },
  statsCard: {
    backgroundColor: '#2d5a5a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
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
  },
  settingsCard: {
    backgroundColor: '#2d5a5a',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  settingTitle: {
    fontSize: 16,
    color: '#ffffff',
  },
  menuCard: {
    backgroundColor: '#2d5a5a',
    borderRadius: 16,
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a3a3a',
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 14,
    color: '#a0aec0',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2d5a5a',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ef4444',
    marginLeft: 8,
  },
});

export default ProfileScreen;
