import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  Users, 
  AlertTriangle, 
  FileText, 
  Activity,
  ChevronRight,
  Bell,
  TrendingUp,
  Clock,
  Package,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  onPress?: () => void;
}

function StatCard({ title, value, icon, color, onPress }: StatCardProps) {
  return (
    <TouchableOpacity 
      style={[styles.statCard, { borderLeftColor: color }]} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.statIconContainer, { backgroundColor: color + '15' }]}>
        {icon}
      </View>
      <View style={styles.statContent}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statTitle}>{title}</Text>
      </View>
    </TouchableOpacity>
  );
}

interface ActivityItemProps {
  type: string;
  patientName: string;
  title: string;
  description?: string;
  timestamp: string;
  severity?: string;
  onPress: () => void;
}

function ActivityItem({ type, patientName, title, description, timestamp, severity, onPress }: ActivityItemProps) {
  const getTypeIcon = () => {
    switch (type) {
      case 'alert':
        return <AlertTriangle size={16} color={severity === 'critical' ? Colors.danger : Colors.warning} />;
      case 'lab_upload':
      case 'lab_result':
        return <FileText size={16} color={Colors.primary} />;
      case 'biometric':
        return <Activity size={16} color={Colors.success} />;
      default:
        return <Clock size={16} color={Colors.textSecondary} />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <TouchableOpacity style={styles.activityItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.activityIcon}>{getTypeIcon()}</View>
      <View style={styles.activityContent}>
        <Text style={styles.activityPatient}>{patientName}</Text>
        <Text style={styles.activityTitle} numberOfLines={1}>{title}</Text>
        {description && (
          <Text style={styles.activityDesc} numberOfLines={1}>{description}</Text>
        )}
      </View>
      <Text style={styles.activityTime}>{formatTime(timestamp)}</Text>
    </TouchableOpacity>
  );
}

interface ReviewItemProps {
  type: string;
  patientName: string;
  title: string;
  priority: string;
  onPress: () => void;
}

function ReviewItem({ patientName, title, priority, onPress }: ReviewItemProps) {
  const getPriorityColor = () => {
    switch (priority) {
      case 'critical': return Colors.danger;
      case 'high': return Colors.warning;
      case 'medium': return Colors.primary;
      default: return Colors.textSecondary;
    }
  };

  return (
    <TouchableOpacity style={styles.reviewItem} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.priorityIndicator, { backgroundColor: getPriorityColor() }]} />
      <View style={styles.reviewContent}>
        <Text style={styles.reviewPatient}>{patientName}</Text>
        <Text style={styles.reviewTitle} numberOfLines={1}>{title}</Text>
      </View>
      <ChevronRight size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );
}

export default function ClinicDashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const statsQuery = trpc.clinic.dashboard.getStats.useQuery({});
  const activityQuery = trpc.clinic.dashboard.getRecentActivity.useQuery({ limit: 10 });
  const reviewsQuery = trpc.clinic.dashboard.getPendingReviews.useQuery({ limit: 5 });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      statsQuery.refetch(),
      activityQuery.refetch(),
      reviewsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [statsQuery, activityQuery, reviewsQuery]);

  const stats = statsQuery.data;
  const activities = activityQuery.data || [];
  const reviews = reviewsQuery.data || [];

  const isLoading = statsQuery.isLoading || activityQuery.isLoading;

  if (isLoading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>Good {getTimeOfDay()}</Text>
        <Text style={styles.subtitle}>Here is your clinic overview</Text>
      </View>

      <View style={styles.statsGrid}>
        <StatCard
          title="Active Patients"
          value={stats?.activePatients || 0}
          icon={<Users size={22} color={Colors.primary} />}
          color={Colors.primary}
          onPress={() => router.push('/(tabs)/(clinic)/patients' as any)}
        />
        <StatCard
          title="Critical Alerts"
          value={stats?.criticalAlerts || 0}
          icon={<AlertTriangle size={22} color={Colors.danger} />}
          color={Colors.danger}
          onPress={() => router.push('/(tabs)/(clinic)/alerts' as any)}
        />
        <StatCard
          title="Pending Reviews"
          value={stats?.pendingReviews || 0}
          icon={<FileText size={22} color={Colors.warning} />}
          color={Colors.warning}
        />
        <StatCard
          title="Lab Uploads Today"
          value={stats?.recentLabUploads || 0}
          icon={<TrendingUp size={22} color={Colors.success} />}
          color={Colors.success}
        />
      </View>

      {reviews.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Needs Attention</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/(clinic)/alerts' as any)}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.reviewsList}>
            {reviews.map((review) => (
              <ReviewItem
                key={review.id}
                type={review.type}
                patientName={review.patientName}
                title={review.title}
                priority={review.priority}
                onPress={() => router.push(`/(tabs)/(clinic)/patient/${review.patientId}` as any)}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
        </View>
        {activities.length === 0 ? (
          <View style={styles.emptyState}>
            <Bell size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>No recent activity</Text>
          </View>
        ) : (
          <View style={styles.activityList}>
            {activities.map((activity) => (
              <ActivityItem
                key={activity.id}
                type={activity.type}
                patientName={activity.patientName}
                title={activity.title}
                description={activity.description}
                timestamp={activity.timestamp}
                severity={activity.severity}
                onPress={() => router.push(`/(tabs)/(clinic)/patient/${activity.patientId}` as any)}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.quickActions}>
        <TouchableOpacity 
          style={styles.quickAction}
          onPress={() => router.push('/(tabs)/(clinic)/patients' as any)}
        >
          <Users size={20} color={Colors.primary} />
          <Text style={styles.quickActionText}>View Patients</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.quickAction}
          onPress={() => router.push('/(tabs)/(clinic)/alerts' as any)}
        >
          <Bell size={20} color={Colors.primary} />
          <Text style={styles.quickActionText}>Alert Inbox</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => router.push('/(tabs)/(clinic)/supplements-admin' as any)}
        >
          <Package size={20} color={Colors.primary} />
          <Text style={styles.quickActionText}>Supplements</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => router.push('/(tabs)/(clinic)/feature-flags' as any)}
        >
          <Package size={20} color={Colors.primary} />
          <Text style={styles.quickActionText}>Feature Flags</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => router.push('/(tabs)/(clinic)/ab-review' as any)}
        >
          <Package size={20} color={Colors.primary} />
          <Text style={styles.quickActionText}>A/B Review</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },
  statCard: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  statTitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  seeAll: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  reviewsList: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  reviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  priorityIndicator: {
    width: 4,
    height: 36,
    borderRadius: 2,
    marginRight: 12,
  },
  reviewContent: {
    flex: 1,
  },
  reviewPatient: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  reviewTitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  activityList: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  activityIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityPatient: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  activityTitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  activityDesc: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  activityTime: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginLeft: 8,
  },
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  quickAction: {
    flex: 1,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quickActionText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
