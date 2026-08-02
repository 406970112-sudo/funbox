import type { PropsWithChildren, RefObject } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';

type MobileScreenProps = PropsWithChildren<{
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollViewRef?: RefObject<ScrollView | null>;
  scrollContentStyle?: StyleProp<ViewStyle>;
}>;

export function MobileScreen({
  children,
  contentContainerStyle,
  scrollViewRef,
  scrollContentStyle,
}: MobileScreenProps) {
  const { colors } = useAppTheme();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, scrollContentStyle]}>
        <View
          style={[
            styles.content,
            {
              maxWidth: appLayout.screenMaxWidth,
            },
            contentContainerStyle,
          ]}>
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 36,
  },
  content: {
    alignSelf: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    width: '100%',
  },
});
