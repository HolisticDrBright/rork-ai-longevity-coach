/**
 * Practitioner Desktop Sync — the patient-side surface of the
 * patient-sync/1 bridge.
 *
 * Shows the desktop connection status, shared resources with their source,
 * version, practitioner-review state and last update, acknowledgment,
 * adherence submission, and revocation. Linking uses ONLY the one-time
 * code from the practitioner (never email/name/phone/DOB matching), and
 * every unavailable or error state is honest — nothing here fabricates a
 * connection or a delivery.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { CheckCircle2, Link2, ShieldOff } from 'lucide-react-native';

import Colors from '@/constants/colors';
import { trpc } from '@/lib/trpc';

export default function DesktopSyncScreen() {
  const [code, setCode] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const utils = trpc.useUtils();
  const status = trpc.sync.status.useQuery();
  const link = trpc.sync.link.useMutation({
    onSuccess: () => { setCode(''); utils.sync.status.invalidate(); },
    onError: (e) => Alert.alert('Could not connect', e.message),
  });
  const acknowledge = trpc.sync.acknowledgeResource.useMutation({
    onSuccess: () => utils.sync.status.invalidate(),
    onError: (e) => Alert.alert('Could not acknowledge', e.message),
  });
  const revoke = trpc.sync.revoke.useMutation({
    onSuccess: () => { setRevokeReason(''); utils.sync.status.invalidate(); },
    onError: (e) => Alert.alert('Could not disconnect', e.message),
  });
  const dispatch = trpc.sync.dispatchOutbox.useMutation({
    onSuccess: () => utils.sync.status.invalidate(),
  });

  const data = status.data;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Practitioner Desktop Sync' }} />
      <ScrollView contentContainerStyle={styles.container} testID="desktop-sync-screen">
        {status.isLoading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : status.isError ? (
          <View style={styles.card} testID="desktop-sync-unavailable">
            <Text style={styles.cardTitle}>Sync is unavailable right now</Text>
            <Text style={styles.body}>
              We could not reach the server. Nothing was changed, and nothing is
              shown that is not real. Please try again later.
            </Text>
          </View>
        ) : !data?.configured ? (
          <View style={styles.card} testID="desktop-sync-not-configured">
            <Text style={styles.cardTitle}>Desktop sync is not configured</Text>
            <Text style={styles.body}>
              This server has no practitioner-desktop connection configured.
              Nothing is being shared.
            </Text>
          </View>
        ) : !data.connection || data.connection.status !== 'active' ? (
          <View style={styles.card} testID="desktop-sync-link">
            <View style={styles.rowCenter}>
              <Link2 color={Colors.primary} size={18} />
              <Text style={styles.cardTitle}>  Connect to your practitioner</Text>
            </View>
            <Text style={styles.body}>
              Enter the one-time code your practitioner gave you in person.
              Connections are made only with this code — never by email, name,
              phone number, or date of birth.
            </Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="One-time connection code"
              autoCapitalize="none"
              autoCorrect={false}
              testID="desktop-sync-code"
            />
            <TouchableOpacity
              style={[styles.button, (!/^[0-9a-f]{64}$/.test(code) || link.isPending) && styles.buttonDisabled]}
              disabled={!/^[0-9a-f]{64}$/.test(code) || link.isPending}
              onPress={() => link.mutate({ code })}
              testID="desktop-sync-link-submit"
            >
              <Text style={styles.buttonText}>{link.isPending ? 'Connecting…' : 'Connect'}</Text>
            </TouchableOpacity>
            {data.connection?.status === 'revoked' && (
              <Text style={styles.subtle} testID="desktop-sync-revoked-note">
                Your previous connection was disconnected
                {data.connection.revokedAt ? ` on ${new Date(data.connection.revokedAt).toLocaleDateString()}` : ''}.
                Reconnecting needs a new code from your practitioner.
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.card} testID="desktop-sync-connected">
              <View style={styles.rowCenter}>
                <CheckCircle2 color={Colors.success} size={18} />
                <Text style={styles.cardTitle}>  Connected to your practitioner</Text>
              </View>
              <Text style={styles.subtle}>
                Connected {new Date(data.connection.verifiedAt).toLocaleDateString()}.
                Your practitioner shares resources here only with your consent,
                scope by scope; you can disconnect at any time below.
              </Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => dispatch.mutate()}
                disabled={dispatch.isPending}
                testID="desktop-sync-dispatch"
              >
                <Text style={styles.secondaryButtonText}>
                  {dispatch.isPending ? 'Syncing…' : 'Send my pending updates now'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card} testID="desktop-sync-resources">
              <Text style={styles.cardTitle}>Shared by your practitioner</Text>
              {data.resources.length === 0 ? (
                <Text style={styles.subtle}>Nothing has been shared yet.</Text>
              ) : (
                data.resources.map((r) => (
                  <View
                    key={`${r.resourceType}:${r.resourceId}`}
                    style={styles.resourceRow}
                    testID={`desktop-sync-resource-${r.resourceType}`}
                  >
                    <Text style={styles.resourceTitle}>
                      {r.resourceType.replace(/_/g, ' ')}
                      {r.tombstoned ? '  (withdrawn)' : ` · v${r.resourceVersion}`}
                    </Text>
                    {r.tombstoned ? (
                      <Text style={styles.subtle}>
                        Withdrawn by your practitioner
                        {r.tombstoneReason ? `: ${r.tombstoneReason}` : ''}.
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.subtle}>
                          From your practitioner&apos;s desktop ·{' '}
                          {r.provenance?.practitionerReviewed === true
                            ? 'practitioner-reviewed'
                            : 'not marked practitioner-reviewed'}
                          {' · updated '}
                          {new Date(r.updatedAt).toLocaleDateString()}
                        </Text>
                        {r.acknowledgedAt ? (
                          <Text style={styles.ackText} testID="desktop-sync-acked">
                            Acknowledged {new Date(r.acknowledgedAt).toLocaleDateString()}
                          </Text>
                        ) : (
                          <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={() => acknowledge.mutate({
                              resourceType: r.resourceType, resourceId: r.resourceId,
                            })}
                            disabled={acknowledge.isPending}
                            testID={`desktop-sync-ack-${r.resourceType}`}
                          >
                            <Text style={styles.secondaryButtonText}>Acknowledge</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                  </View>
                ))
              )}
            </View>

            <View style={styles.card} testID="desktop-sync-revoke">
              <View style={styles.rowCenter}>
                <ShieldOff color={Colors.danger} size={18} />
                <Text style={styles.cardTitle}>  Disconnect</Text>
              </View>
              <Text style={styles.subtle}>
                Disconnecting stops all future sharing immediately, in both
                directions. Records your practitioner already holds are part of
                your chart and are not deleted by disconnecting.
              </Text>
              <TextInput
                style={styles.input}
                value={revokeReason}
                onChangeText={setRevokeReason}
                placeholder="Reason (required)"
                testID="desktop-sync-revoke-reason"
              />
              <TouchableOpacity
                style={[styles.dangerButton, (!revokeReason.trim() || revoke.isPending) && styles.buttonDisabled]}
                disabled={!revokeReason.trim() || revoke.isPending}
                onPress={() => revoke.mutate({ reason: revokeReason.trim() })}
                testID="desktop-sync-revoke-submit"
              >
                <Text style={styles.buttonText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { padding: 16, gap: 12 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12,
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: Colors.text },
  body: { fontSize: 13.5, color: Colors.textSecondary, marginTop: 6, lineHeight: 19 },
  subtle: { fontSize: 12.5, color: Colors.textTertiary, marginTop: 6, lineHeight: 18 },
  ackText: { fontSize: 12.5, color: Colors.success, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 10,
    padding: 12, marginTop: 10, fontSize: 13, color: Colors.text,
    backgroundColor: Colors.background,
  },
  button: {
    backgroundColor: Colors.primary, borderRadius: 10, padding: 13,
    alignItems: 'center', marginTop: 10,
  },
  dangerButton: {
    backgroundColor: '#c0392b', borderRadius: 10, padding: 13,
    alignItems: 'center', marginTop: 10,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  secondaryButton: {
    borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginTop: 8,
  },
  secondaryButtonText: { color: Colors.primary, fontWeight: '600', fontSize: 12.5 },
  resourceRow: {
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
    paddingVertical: 10, marginTop: 8,
  },
  resourceTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
});
