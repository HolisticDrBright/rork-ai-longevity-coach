import { useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { X } from 'lucide-react-native';
import Colors from '@/constants/colors';

const REDIRECT_SCHEME = 'rork-app://vital-callback';

interface Props {
  visible: boolean;
  url: string | null;
  onClose: () => void;
  onConnected?: (provider?: string) => void;
}

export default function LinkWebViewModal({ visible, url, onClose, onConnected }: Props) {
  useEffect(() => {
    if (!visible || !url) return;

    let cancelled = false;

    WebBrowser.openAuthSessionAsync(url, REDIRECT_SCHEME, {
      showInRecents: true,
    }).then((result) => {
      if (cancelled) return;
      if (result.type === 'success') {
        try {
          const parsed = new URL(result.url);
          const provider = parsed.searchParams.get('provider') ?? undefined;
          onConnected?.(provider);
        } catch {
          onConnected?.();
        }
      }
      onClose();
    }).catch(() => {
      if (!cancelled) onClose();
    });

    return () => { cancelled = true; };
  }, [visible, url]);

  // Shown while the link URL is being fetched (url is still null)
  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Connect device</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.body}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.label}>
              {url ? 'Opening browser…' : 'Preparing connection…'}
            </Text>
            <Text style={styles.hint}>
              Complete the sign-in in the browser window that opens, then return here.
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: Colors.text },
  closeButton: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center', alignItems: 'center',
  },
  body: { alignItems: 'center', gap: 14, paddingTop: 32, paddingHorizontal: 32 },
  label: { fontSize: 15, fontWeight: '600', color: Colors.text },
  hint: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
});
