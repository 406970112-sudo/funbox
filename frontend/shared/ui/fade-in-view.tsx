import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export function FadeInView({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;

    function finish() {
      if (mounted) opacity.setValue(1);
    }

    if (Platform.OS === 'web') {
      const reduceMotion =
        typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false;
      if (reduceMotion) {
        finish();
        return undefined;
      }
    } else {
      void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
        if (enabled) finish();
      });
    }

    const animation = Animated.timing(opacity, {
      duration: 300,
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => {
      mounted = false;
      animation.stop();
    };
  }, [opacity]);

  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
