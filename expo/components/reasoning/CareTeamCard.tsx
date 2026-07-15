import React, { useState } from 'react';
import {
  Alert,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Copy, ShieldCheck, UserMinus } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';
import { useSupabaseAuth } from '@/providers/SupabaseAuthProvider';
import { featureFlags } from '@/lib/featureFlags';

/**
 * Patient-side consent management: share your code with a practitioner, or
 * paste a practitioner's code to grant them access to your record. Every grant
 * and revoke is recorded in the server-side audit log.
 */
export function CareTeamCard() {
  const { user } = useSupabaseAuth();
  const [practitionerCode, setPractitionerCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const utils = trpc.useUtils();

  const relationships = trpc.reasoning.relationships.list.useQuery(undefined, {
    enabled: featureFlags.clinicalReasoning && !!user,
  });

  const grant = trpc.reasoning.relationships.grant.useMutation({
    onSuccess: () => {
      setPractitionerCode('');
      void utils.reasoning.relationships.list.invalidate();
      Alert.alert('Access granted', 'Your practitioner can now view your timeline and reasoning record.');
    },
    onError: (e) => Alert.alert('Could not grant access', e.message),
  });

  const revoke = trpc.reasoning.relationships.revoke.useMutation({
    onSuccess: () => void utils.reasoning.relationships.list.invalidate(),
    onError: (e) => Alert.alert('Could not revoke', e.message),
  });

  if (!featureFlags.clinicalReasoning || !user) return null;

  const myGrants = (relationships.data ?? []).filter(
    (r) => r.patientId === user.id && r.status === 'active'
  );

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    practitionerCode.trim()
  );

  return (
    <View style={styles.card} testID="care-team-card">
      <View style={styles.headerRow}>
        <ShieldCheck size={18} color={Colors.primary} />
        <Text style={styles.title}>Care team access</Text>
      </View>
      <Text style={styles.subtitle}>
        Practitioners can only see your record after you grant access here. You can revoke at any time;
        all access is audited.
      </Text>

      <Text style={styles.label}>Your share code</Text>
      <TouchableOpacity
        style={styles.codeRow}
        onPress={() => {
          void Share.share({
            message: `My AI Longevity Pro record code: ${user.id}`,
          }).catch(() => {
            Alert.alert('Your share code', user.id);
          });
        }}
      >
        <Text style={styles.codeText} numberOfLines={1}>
          {user.id}
        </Text>
        <Copy size={14} color={Colors.textSecondary} />
      </TouchableOpacity>

      <Text style={styles.label}>Grant a practitioner access</Text>
      <TextInput
        style={styles.input}
        placeholder="Practitioner's code"
        placeholderTextColor={Colors.textTertiary}
        autoCapitalize="none"
        value={practitionerCode}
        onChangeText={setPractitionerCode}
        testID="practitioner-code-input"
      />
      <TextInput
        style={styles.input}
        placeholder="Your display name for this practitioner (optional)"
        placeholderTextColor={Colors.textTertiary}
        value={displayName}
        onChangeText={setDisplayName}
      />
      <TouchableOpacity
        style={[styles.grantButton, (!isUuid || grant.isPending) && styles.grantButtonDisabled]}
        disabled={!isUuid || grant.isPending}
        onPress={() =>
          grant.mutate({
            practitionerId: practitionerCode.trim().toLowerCase(),
            note: displayName.trim() || undefined,
          })
        }
        testID="grant-access-button"
      >
        <Text style={styles.grantButtonText}>Grant access</Text>
      </TouchableOpacity>

      {myGrants.length > 0 && (
        <>
          <Text style={styles.label}>Active authorizations</Text>
          {myGrants.map((r) => (
            <View key={r.id} style={styles.grantRow}>
              <Text style={styles.grantText} numberOfLines={1}>
                Practitioner {r.practitionerId.slice(0, 8)}… · since {new Date(r.createdAt).toLocaleDateString()}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  Alert.alert('Revoke access?', 'The practitioner will immediately lose access to your record.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Revoke', style: 'destructive', onPress: () => revoke.mutate({ relationshipId: r.id }) },
                  ])
                }
                testID={`revoke-${r.id}`}
              >
                <UserMinus size={16} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 16,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17, marginBottom: 12 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
    marginBottom: 6,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  codeText: { flex: 1, fontSize: 12, color: Colors.textSecondary, fontFamily: undefined },
  input: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
    color: Colors.text,
    marginBottom: 8,
  },
  grantButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  grantButtonDisabled: { opacity: 0.5 },
  grantButtonText: { color: Colors.textInverse, fontSize: 13, fontWeight: '600' },
  grantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 8,
  },
  grantText: { flex: 1, fontSize: 13, color: Colors.text },
});
