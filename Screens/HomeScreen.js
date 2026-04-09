import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialIcons';

const HomeScreen = ({ navigation }) => {
  return (
    <View style={styles.container}>
      {/* Main Content */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Question of the Day Card */}
        <LinearGradient
          colors={['#a8e6cf', '#7fcdbb']}
          style={styles.featuredCard}
        >
          <Text style={styles.featuredCardTitle}>Question Of The Day!</Text>
        </LinearGradient>

        {/* Track Progress Card */}
        <TouchableOpacity style={styles.card}>
          <Text style={styles.cardTitle}>Track your progress</Text>
          <View style={styles.cardArrow}>
            <Icon name="arrow-upward" size={20} color="#4a5568" />
            <Icon name="arrow-forward" size={20} color="#4a5568" />
          </View>
        </TouchableOpacity>

        {/* Streak Card */}
        <View style={styles.streakCard}>
          <Text style={styles.streakLabel}>Streak</Text>
          <Text style={styles.streakNumber}>12</Text>
        </View>

        {/* Before Exam Card */}
        <TouchableOpacity style={styles.card}>
          <Text style={styles.cardTitle}>Before Exam Formulas, Theorems & Diagrams</Text>
          <View style={styles.cardArrow}>
            <Icon name="arrow-upward" size={20} color="#4a5568" />
            <Icon name="arrow-forward" size={20} color="#4a5568" />
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#1a3a3a',
  },
  menuButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSpacer: {
    width: 40, // Same width as menu button to center title
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  featuredCard: {
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  featuredCardTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a3a3a',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#2d3748',
    lineHeight: 22,
  },
  cardArrow: {
    flexDirection: 'column',
    alignItems: 'center',
    marginLeft: 12,
  },
  streakCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  streakLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4a5568',
    marginBottom: 8,
  },
  streakNumber: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#2d3748',
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#1a3a3a',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#2d5a5a',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  navLabel: {
    fontSize: 12,
    color: '#a0aec0',
    marginTop: 4,
  },
  navLabelActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
});

export default HomeScreen;
