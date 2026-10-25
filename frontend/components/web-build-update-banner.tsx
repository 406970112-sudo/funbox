import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import {
  fetchLatestWebBuildInfo,
  isNewerWebBuild,
  readLoadedWebBuildInfo,
  reloadForWebBuild,
  type WebBuildInfo,
} from '@/lib/web-build-version';

const VERSION_CHECK_INTERVAL_MS = 60_000;

type WebBuildUpdateBannerProps = {
  pathname: string;
};

export function WebBuildUpdateBanner({ pathname }: WebBuildUpdateBannerProps) {
  const { colors } = useAppTheme();
  const [latestBuild, setLatestBuild] = useState<WebBuildInfo | null>(null);
  const latestBuildRef = useRef<WebBuildInfo | null>(null);
  const initialPathnameRef = useRef(pathname);

  useEffect(() => {
    latestBuildRef.current = latestBuild;
  }, [latestBuild]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const currentBuild = readLoadedWebBuildInfo();
    if (!currentBuild) {
      return;
    }

    let disposed = false;
    let checking = false;
    let reloadWhenFoundRequested = false;

    const checkForUpdate = async (reloadWhenFound: boolean) => {
      reloadWhenFoundRequested ||= reloadWhenFound;
      if (disposed || checking) {
        return;
      }

      checking = true;
      const nextBuild = await fetchLatestWebBuildInfo();
      checking = false;
      const shouldReload = reloadWhenFoundRequested;
      reloadWhenFoundRequested = false;
      if (disposed || !nextBuild || !isNewerWebBuild(currentBuild, nextBuild)) {
        return;
      }

      if (shouldReload && reloadForWebBuild(nextBuild)) {
        return;
      }

      latestBuildRef.current = nextBuild;
      setLatestBuild(nextBuild);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      if (latestBuildRef.current) {
        reloadForWebBuild(latestBuildRef.current);
        return;
      }

      void checkForUpdate(true);
    };

    const onFocus = () => {
      if (latestBuildRef.current) {
        reloadForWebBuild(latestBuildRef.current);
      }
    };

    void checkForUpdate(false);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate(false);
      }
    }, VERSION_CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (pathname === initialPathnameRef.current) {
      return;
    }

    if (latestBuildRef.current) {
      reloadForWebBuild(latestBuildRef.current);
    }
  }, [pathname]);

  if (Platform.OS !== 'web' || !latestBuild) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          shadowColor: colors.shadow,
        },
      ]}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>新版本已发布</Text>
        <Text style={[styles.description, { color: colors.mutedText }]}>重新加载后即可使用最新功能。</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => reloadForWebBuild(latestBuild)}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 },
        ]}>
        <Text style={styles.buttonText}>立即更新</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 88,
    zIndex: 10000,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 12,
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
});
