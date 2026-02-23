import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { writeAuditLog, getAuditLogs, verifyAuditIntegrity, AuditEntry } from '@/lib/auditLog';
import { getBreachEvents, getUnacknowledgedBreaches, acknowledgeBreachEvent, BreachEvent } from '@/lib/breachDetection';
import { purgeAllPHI } from '@/lib/secureStorage';

const CONSENT_KEY = 'hipaa_consent_accepted';
const PRIVACY_NOTICE_VERSION = '1.0.0';

interface HIPAAConsent {
  accepted: boolean;
  timestamp: string;
  version: string;
}

export const [HIPAAProvider, useHIPAA] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [consentLoading, setConsentLoading] = useState(true);

  const consentQuery = useQuery({
    queryKey: ['hipaaConsent'],
    queryFn: async () => {
      const raw = await AsyncStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      const consent: HIPAAConsent = JSON.parse(raw);
      if (consent.version !== PRIVACY_NOTICE_VERSION) return null;
      return consent;
    },
  });

  useEffect(() => {
    if (consentQuery.data !== undefined) {
      setConsentAccepted(!!consentQuery.data?.accepted);
      setConsentLoading(false);
    }
  }, [consentQuery.data]);

  const acceptConsentMutation = useMutation({
    mutationFn: async () => {
      const consent: HIPAAConsent = {
        accepted: true,
        timestamp: new Date().toISOString(),
        version: PRIVACY_NOTICE_VERSION,
      };
      await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
      await writeAuditLog('PHI_CREATE', 'hipaa_consent', 'user', 'Privacy consent accepted');
      return consent;
    },
    onSuccess: () => {
      setConsentAccepted(true);
      queryClient.invalidateQueries({ queryKey: ['hipaaConsent'] });
    },
  });

  const breachEventsQuery = useQuery({
    queryKey: ['breachEvents'],
    queryFn: getBreachEvents,
    refetchInterval: 60000,
  });

  const unacknowledgedBreachesQuery = useQuery({
    queryKey: ['unacknowledgedBreaches'],
    queryFn: getUnacknowledgedBreaches,
    refetchInterval: 30000,
  });

  const auditLogsQuery = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => getAuditLogs(),
    enabled: false,
  });

  const auditIntegrityQuery = useQuery({
    queryKey: ['auditIntegrity'],
    queryFn: verifyAuditIntegrity,
    enabled: false,
  });

  const acknowledgeBreachMutation = useMutation({
    mutationFn: acknowledgeBreachEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breachEvents'] });
      queryClient.invalidateQueries({ queryKey: ['unacknowledgedBreaches'] });
    },
  });

  const purgeDataMutation = useMutation({
    mutationFn: async () => {
      await writeAuditLog('DATA_PURGE', 'all_phi', 'user', 'User requested full PHI deletion');
      await purgeAllPHI();
      return true;
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });

  const acceptConsent = useCallback(() => {
    acceptConsentMutation.mutate();
  }, [acceptConsentMutation]);

  const requestDataDeletion = useCallback(() => {
    purgeDataMutation.mutate();
  }, [purgeDataMutation]);

  const acknowledgeBreach = useCallback(
    (eventId: string) => {
      acknowledgeBreachMutation.mutate(eventId);
    },
    [acknowledgeBreachMutation]
  );

  const fetchAuditLogs = useCallback(() => {
    auditLogsQuery.refetch();
  }, [auditLogsQuery]);

  const checkAuditIntegrity = useCallback(() => {
    auditIntegrityQuery.refetch();
  }, [auditIntegrityQuery]);

  const breachEvents = useMemo(
    () => breachEventsQuery.data ?? [],
    [breachEventsQuery.data]
  );

  const unacknowledgedBreaches = useMemo(
    () => unacknowledgedBreachesQuery.data ?? [],
    [unacknowledgedBreachesQuery.data]
  );

  const hasActiveBreaches = unacknowledgedBreaches.length > 0;

  return {
    consentAccepted,
    consentLoading,
    acceptConsent,
    breachEvents,
    unacknowledgedBreaches,
    hasActiveBreaches,
    acknowledgeBreach,
    requestDataDeletion,
    isDeleting: purgeDataMutation.isPending,
    deletionComplete: purgeDataMutation.isSuccess,
    auditLogs: auditLogsQuery.data as AuditEntry[] | undefined,
    auditIntegrity: auditIntegrityQuery.data,
    fetchAuditLogs,
    checkAuditIntegrity,
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  };
});
