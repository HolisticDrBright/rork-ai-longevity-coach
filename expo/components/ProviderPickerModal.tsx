import {
  Modal,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  SafeAreaView,
} from 'react-native';
import { X, Watch } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useJunctionProviders } from '@/hooks/useHealthData';

interface Provider {
  name: string;
  slug: string;
  description: string;
  logo?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (provider: Provider) => void;
}

export default function ProviderPickerModal({ visible, onClose, onSelect }: Props) {
  const { data: providers, isLoading, isError } = useJunctionProviders();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Choose a device</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>Select the wearable or app you want to connect.</Text>

        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>Loading providers…</Text>
          </View>
        )}

        {isError && (
          <View style={styles.centered}>
            <Text style={styles.errorText}>Failed to load providers. Please try again.</Text>
          </View>
        )}

        {providers && (
          <FlatList
            data={providers}
            keyExtractor={(item) => item.slug}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.providerRow} onPress={() => onSelect(item)} activeOpacity={0.7}>
                <View style={styles.logoContainer}>
                  {item.logo ? (
                    <Image source={{ uri: item.logo }} style={styles.logo} resizeMode="contain" />
                  ) : (
                    <Watch size={22} color={Colors.primary} />
                  )}
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>{item.name}</Text>
                  {item.description ? (
                    <Text style={styles.providerDesc} numberOfLines={2}>{item.description}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text },
  closeButton: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center', alignItems: 'center',
  },
  subtitle: {
    fontSize: 13, color: Colors.textSecondary,
    paddingHorizontal: 20, paddingBottom: 12,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 14, color: Colors.danger, textAlign: 'center', paddingHorizontal: 32 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  separator: { height: 1, backgroundColor: Colors.borderLight },
  providerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 4,
  },
  logoContainer: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: Colors.surfaceSecondary,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
  },
  logo: { width: 40, height: 40 },
  providerInfo: { flex: 1, gap: 2 },
  providerName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  providerDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
});
