import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { DevSettings, Platform } from 'react-native';
import 'react-native-reanimated';

import { WebBuildUpdateBanner } from '@/components/web-build-update-banner';
import { AuthProvider } from '@/features/auth/auth-provider';
import { FeatureAccessProvider } from '@/features/access/feature-access-provider';
import { BlogProvider } from '@/features/blog/blog-provider';
import { FeedbackProvider } from '@/features/feedback/feedback-provider';
import { GameSocialProvider } from '@/features/games/game-social-provider';
import { MomentsProvider } from '@/features/moments/moments-provider';
import { SocialProvider } from '@/features/social/social-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { installSafeRouterBack, trackBackContext } from '@/lib/router-back';
import { markStartupMilestone } from '@/lib/startup-metrics';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';

export const unstable_settings = {
  anchor: '(tabs)',
};

const MOBILE_WEB_INPUT_STYLE_ID = 'mobile-web-input-zoom-guard';

void SplashScreen.preventAutoHideAsync();

installSafeRouterBack();

const appFonts = {
  ionicons: require('../assets/fonts/Ionicons-subset.ttf'),
  'material-community': require('../assets/fonts/MaterialCommunityIcons-subset.ttf'),
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { colors } = useAppTheme();
  const pathname = usePathname();
  const [fontsLoaded, fontError] = useFonts(appFonts);

  useEffect(() => {
    markStartupMilestone('layout-mounted');
  }, []);

  useEffect(() => {
    trackBackContext(pathname);
  }, [pathname]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      markStartupMilestone('fonts-ready');
      void SplashScreen.hideAsync();
    }
  }, [fontError, fontsLoaded]);

  useEffect(() => {
    if (Platform.OS !== 'web' || document.getElementById(MOBILE_WEB_INPUT_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = MOBILE_WEB_INPUT_STYLE_ID;
    style.textContent = `
      @media (max-width: 1024px) {
        input, textarea, select, [contenteditable='true'] {
          font-size: 16px !important;
        }
      }
    `;
    document.head.appendChild(style);

    return () => style.remove();
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

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <WebBuildUpdateBanner pathname={pathname} />
      <AuthProvider>
        <FeatureAccessProvider>
          <SocialProvider>
            <MomentsProvider>
              <BlogProvider>
                <FeedbackProvider>
                  <GameSocialProvider>
                    {fontsLoaded ? (
                      <>
                        <Stack
                          screenOptions={{
                            animation: 'slide_from_right',
                            contentStyle: { backgroundColor: colors.background },
                            headerShown: false,
                          }}>
                          <Stack.Screen name="(tabs)" />
                          <Stack.Screen name="auth" options={{ animation: 'slide_from_bottom' }} />
                          <Stack.Screen name="profile/edit" options={{ animation: 'slide_from_right' }} />
                          <Stack.Screen name="profile/security" options={{ animation: 'slide_from_right' }} />
                          <Stack.Screen name="profile/feedback" options={{ animation: 'slide_from_right' }} />
                          <Stack.Screen
                            name="profile/feedback/history"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen
                            name="profile/feedback/result/[id]"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen
                            name="profile/membership"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen
                            name="profile/membership/payment"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen name="admin" options={{ animation: 'slide_from_right' }} />
                          <Stack.Screen name="reading/import" options={{ animation: 'slide_from_bottom' }} />
                          <Stack.Screen
                            name="reading/books/[bookId]"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen
                            name="reading/books/[bookId]/chapters/[chapterId]"
                            options={{ animation: 'fade' }}
                          />
                          <Stack.Screen
                            name="social/add-friend"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen
                            name="social/chat/[conversationId]"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen name="moments/create" options={{ animation: 'slide_from_bottom' }} />
                          <Stack.Screen
                            name="moments/[momentId]"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen
                            name="moments/notifications"
                            options={{ animation: 'slide_from_right' }}
                          />
                          <Stack.Screen name="blog/create" options={{ animation: 'slide_from_bottom' }} />
                          <Stack.Screen name="blog/[postId]" options={{ animation: 'slide_from_right' }} />
                          <Stack.Screen name="blog/mine" options={{ animation: 'slide_from_right' }} />
                          <Stack.Screen
                            name="blog/notifications"
                            options={{ animation: 'slide_from_right' }}
                          />
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
                      </>
                    ) : (
                      <AppLoadingScreen />
                    )}
                  </GameSocialProvider>
                </FeedbackProvider>
              </BlogProvider>
            </MomentsProvider>
          </SocialProvider>
        </FeatureAccessProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
