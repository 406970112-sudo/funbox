import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DevSettings, Platform } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider } from '@/features/auth/auth-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';

export const unstable_settings = {
  anchor: '(tabs)',
};

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
  });

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  if (fontError) {
    return (
      <AppLoadingScreen
        error
        onRetry={() => {
          if (Platform.OS === 'web') {
            window.location.reload();
          } else {
            DevSettings.reload();
          }
        }}
      />
    );
  }

  if (!fontsLoaded) {
    return <AppLoadingScreen />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile/edit" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="profile/security" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="tools/[toolId]"
            options={{
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="games/[gameId]"
            options={{
              animation: 'slide_from_right',
            }}
          />
        </Stack>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </AuthProvider>
    </ThemeProvider>
  );
}
