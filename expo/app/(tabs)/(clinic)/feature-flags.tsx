import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { Flag, Users, Percent, Save, Plus, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

interface FlagRow {
  key: string;
  enabled_user_ids: string[] | null;
  enabled_roles: string[] | null;
  rollout_pct: number | null;
  description: string | null;
  updated_at: string;
}

function FlagCard({ flag, onSave, saving }: {
  flag: FlagRow;
  onSave: (payload: {
    enabledUserIds: string[];
    enabledRoles: string[];
    rolloutPct: number;
  }) => Promise<void>;
  saving: boolean;
}) {
  const [userIds, setUserIds] = useState<string[]>(flag.enabled_user_ids ?? []);
  const [roles, setRoles] = useState<string[]>(flag.enabled_roles ?? []);
  const [rollout, setRollout] = useState<string>(String(flag.rollout_pct ?? 0));
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState('');
  const [dirty, setDirty] = useState(false);

  const markDirty = () => setDirty(true);

  const addUserId = () => {
    const trimmed = newUserId.trim();
    if (!trimmed) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      Alert.alert('Invalid', 'Enter a UUID (e.g. 550e8400-e29b-41d4-a716-446655440000).');
      return;
    }
    if (userIds.includes(trimmed)) return;
    setUserIds([...userIds, trimmed]);
    setNewUserId('');
    markDirty();
  };

  const removeUserId = (id: string) => {
    setUserIds(userIds.filter(u => u !== id));
    markDirty();
  };

  const addRole = () => {
    const trimmed = newRole.trim().toLowerCase();
    if (!trimmed || roles.includes(trimmed)) return;
    setRoles([...roles, trimmed]);
    setNewRole('');
    markDirty();
  };

  const removeRole = (r: string) => {
    setRoles(roles.filter(x => x !== r));
    markDirty();
  };

  const handleSave = async () => {
    const pct = Math.max(0, Math.min(100, parseInt(rollout, 10) || 0));
    await onSave({ enabledUserIds: userIds, enabledRoles: roles, rolloutPct: pct });
    setDirty(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Flag color={Colors.primary} size={18} />
        <Text style={styles.flagKey}>{flag.key}</Text>
      </View>
      {flag.description && <Text style={styles.flagDescription}>{flag.description}</Text>}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Users color={Colors.textSecondary} size={14} />
          <Text style={styles.sectionLabel}>Enabled user IDs ({userIds.length})</Text>
        </View>
        <View style={styles.chipList}>
          {userIds.map(id => (
            <View key={id} style={styles.chip}>
              <Text style={styles.chipText}>{id.substring(0, 8)}…</Text>
              <TouchableOpacity onPress={() => removeUserId(id)}>
                <X color={Colors.textSecondary} size={12} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={newUserId}
            onChangeText={setNewUserId}
            placeholder="Paste user UUID"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addUserId}>
            <Plus color="#fff" size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Users color={Colors.textSecondary} size={14} />
          <Text style={styles.sectionLabel}>Enabled roles ({roles.length})</Text>
        </View>
        <View style={styles.chipList}>
          {roles.map(r => (
            <View key={r} style={styles.chip}>
              <Text style={styles.chipText}>{r}</Text>
              <TouchableOpacity onPress={() => removeRole(r)}>
                <X color={Colors.textSecondary} size={12} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={newRole}
            onChangeText={setNewRole}
            placeholder="role (e.g. practitioner)"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.addBtn} onPress={addRole}>
            <Plus color="#fff" size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Percent color={Colors.textSecondary} size={14} />
          <Text style={styles.sectionLabel}>Rollout percentage</Text>
        </View>
        <TextInput
          style={styles.input}
          value={rollout}
          onChangeText={(v) => { setRollout(v); markDirty(); }}
          keyboardType="numeric"
          placeholder="0"
        />
        <Text style={styles.hint}>Deterministic bucketing on user id; same user always lands in same bucket.</Text>
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, !dirty && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!dirty || saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Save color="#fff" size={16} />
            <Text style={styles.saveBtnText}>{dirty ? 'Save changes' : 'No changes'}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function FeatureFlagsScreen() {
  const flagsQuery = trpc.longevity.listFlags.useQuery();
  const setFlagMutation = trpc.longevity.setFlag.useMutation();
  const utils = trpc.useUtils();

  const flags = useMemo(() => (flagsQuery.data as FlagRow[] | undefined) ?? [], [flagsQuery.data]);

  const handleSave = async (key: string, payload: {
    enabledUserIds: string[];
    enabledRoles: string[];
    rolloutPct: number;
  }) => {
    try {
      await setFlagMutation.mutateAsync({ key, ...payload });
      await utils.longevity.listFlags.invalidate();
      Alert.alert('Saved', `Flag "${key}" updated.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save flag.');
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Feature Flags' }} />
      {flagsQuery.isLoading ? (
        <View style={styles.loading}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : flagsQuery.isError ? (
        <View style={styles.loading}>
          <Text style={styles.errorText}>
            Admin access required. Only admin-role users can view feature flags.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.header}>Feature Flags</Text>
          <Text style={styles.subheader}>
            Toggle cohorts into experimental paths. Default is off — only users in
            the explicit list or hashed into the rollout bucket are opted in.
          </Text>
          {flags.map(flag => (
            <FlagCard
              key={flag.key}
              flag={flag}
              onSave={(payload) => handleSave(flag.key, payload)}
              saving={setFlagMutation.isPending}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  header: { fontSize: 22, fontWeight: '800', color: Colors.text },
  subheader: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 14, color: Colors.danger, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 14, gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flagKey: { fontSize: 15, fontWeight: '700', color: Colors.text, fontFamily: 'Courier' },
  flagDescription: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  chipList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceSecondary, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  chipText: { fontSize: 11, color: Colors.text, fontFamily: 'Courier' },
  addRow: { flexDirection: 'row', gap: 6 },
  input: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, color: Colors.text, fontFamily: 'Courier',
  },
  addBtn: {
    backgroundColor: Colors.primary, width: 36, height: 36, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
  },
  hint: { fontSize: 11, color: Colors.textTertiary, fontStyle: 'italic' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12,
    marginTop: 4,
  },
  saveBtnDisabled: { backgroundColor: Colors.textTertiary },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
