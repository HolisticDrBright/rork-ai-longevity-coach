import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { 
  Search, 
  User, 
  AlertTriangle, 
  ChevronRight,
  Filter,
  Plus,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

type PatientStatus = 'active' | 'inactive' | 'archived';

interface PatientItemProps {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  status: PatientStatus;
  alertCount: number;
  lastActivity?: string;
  tags: string[];
  onPress: () => void;
}

function PatientItem({ 
  firstName, 
  lastName, 
  email, 
  status, 
  alertCount, 
  lastActivity,
  tags,
  onPress 
}: PatientItemProps) {
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'No activity';
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getStatusColor = () => {
    switch (status) {
      case 'active': return Colors.success;
      case 'inactive': return Colors.warning;
      case 'archived': return Colors.textTertiary;
    }
  };

  return (
    <TouchableOpacity style={styles.patientItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {firstName.charAt(0)}{lastName.charAt(0)}
        </Text>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
      </View>
      
      <View style={styles.patientInfo}>
        <Text style={styles.patientName}>{firstName} {lastName}</Text>
        {email && <Text style={styles.patientEmail} numberOfLines={1}>{email}</Text>}
        <View style={styles.patientMeta}>
          <Text style={styles.lastActivity}>{formatDate(lastActivity)}</Text>
          {tags.slice(0, 2).map((tag, index) => (
            <View key={index} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.patientActions}>
        {alertCount > 0 && (
          <View style={styles.alertBadge}>
            <AlertTriangle size={12} color={Colors.textInverse} />
            <Text style={styles.alertCount}>{alertCount}</Text>
          </View>
        )}
        <ChevronRight size={20} color={Colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

export default function PatientsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PatientStatus | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const patientsQuery = trpc.clinic.dashboard.getPatientList.useQuery({
    search: search || undefined,
    status: statusFilter,
    limit: 100,
  });

  const patients = patientsQuery.data || [];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await patientsQuery.refetch();
    setRefreshing(false);
  }, [patientsQuery]);

  const filteredPatients = useMemo(() => {
    if (!search) return patients;
    const searchLower = search.toLowerCase();
    return patients.filter(
      p => 
        p.firstName.toLowerCase().includes(searchLower) ||
        p.lastName.toLowerCase().includes(searchLower) ||
        p.email?.toLowerCase().includes(searchLower)
    );
  }, [patients, search]);

  const statusFilters: { label: string; value: PatientStatus | undefined }[] = [
    { label: 'All', value: undefined },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Archived', value: 'archived' },
  ];

  const renderPatient = useCallback(({ item }: { item: typeof patients[0] }) => (
    <PatientItem
      id={item.id}
      firstName={item.firstName}
      lastName={item.lastName}
      email={item.email}
      status={item.status}
      alertCount={item.alertCount}
      lastActivity={item.lastActivity}
      tags={item.tags}
      onPress={() => router.push(`/(tabs)/(clinic)/patient/${item.id}`)}
    />
  ), [router]);

  const ListHeader = useMemo(() => (
    <View style={styles.listHeader}>
      <View style={styles.searchContainer}>
        <Search size={18} color={Colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search patients..."
          placeholderTextColor={Colors.textTertiary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <X size={18} color={Colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity 
        style={[styles.filterButton, showFilters && styles.filterButtonActive]}
        onPress={() => setShowFilters(!showFilters)}
      >
        <Filter size={18} color={showFilters ? Colors.textInverse : Colors.primary} />
      </TouchableOpacity>
    </View>
  ), [search, showFilters]);

  return (
    <View style={styles.container}>
      {ListHeader}

      {showFilters && (
        <View style={styles.filtersContainer}>
          <Text style={styles.filterLabel}>Status</Text>
          <View style={styles.filterChips}>
            {statusFilters.map((filter) => (
              <TouchableOpacity
                key={filter.label}
                style={[
                  styles.filterChip,
                  statusFilter === filter.value && styles.filterChipActive
                ]}
                onPress={() => setStatusFilter(filter.value)}
              >
                <Text style={[
                  styles.filterChipText,
                  statusFilter === filter.value && styles.filterChipTextActive
                ]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {patientsQuery.isLoading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : filteredPatients.length === 0 ? (
        <View style={styles.emptyContainer}>
          <User size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No Patients Found</Text>
          <Text style={styles.emptySubtitle}>
            {search ? 'Try a different search term' : 'Add your first patient to get started'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredPatients}
          renderItem={renderPatient}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 90 }]} activeOpacity={0.8}>
        <Plus size={24} color={Colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listHeader: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: Colors.background,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: Colors.primary,
  },
  filtersContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: Colors.background,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  filterChipTextActive: {
    color: Colors.textInverse,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  patientItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.primary + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  statusDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  patientInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  patientEmail: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  patientMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  lastActivity: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  tag: {
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  patientActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  alertCount: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textInverse,
  },
  separator: {
    height: 10,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
