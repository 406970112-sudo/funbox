import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getEmailAgentAppUrl } from '@/lib/email-agent-app';

export function ReleaseEmailAssistantScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const appUrl = getEmailAgentAppUrl();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.toolbar, { backgroundColor: colors.card, borderBottomColor: colors.line }]}>
        <Pressable
          accessibilityLabel="返回"
          onPress={() => router.back()}
          style={styles.iconButton}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <ThemedText numberOfLines={1} style={styles.title}>
          发版邮件助手
        </ThemedText>
        <Pressable
          accessibilityLabel="在浏览器中打开"
          onPress={() => void Linking.openURL(appUrl)}
          style={styles.iconButton}>
          <MaterialCommunityIcons name="open-in-new" size={20} color={colors.text} />
        </Pressable>
      </View>

      <WebView
        allowsBackForwardNavigationGestures
        originWhitelist={['http://*', 'https://*']}
        renderLoading={() => (
          <View style={[styles.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}
        setSupportMultipleWindows={false}
        source={{ uri: appUrl }}
        startInLoadingState
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  loading: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  screen: {
    flex: 1,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  toolbar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 8,
  },
  webView: {
    flex: 1,
  },
});
