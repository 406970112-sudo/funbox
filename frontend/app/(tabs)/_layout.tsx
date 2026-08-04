import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { appLayout } from '@/constants/app-theme';
import { useBlog } from '@/features/blog/blog-provider';
import { useFeedback } from '@/features/feedback/feedback-provider';
import { useMoments } from '@/features/moments/moments-provider';
import { useSocial } from '@/features/social/social-provider';
import { getUnreadMessageState } from '@/features/social/unread-message-state';
import { useAppTheme } from '@/hooks/use-app-theme';

export default function TabLayout() {
  const { colors } = useAppTheme();
  const { conversations } = useSocial();
  const { unreadCount: momentUnreadCount } = useMoments();
  const { unreadCount: blogUnreadCount } = useBlog();
  const { unreadCount: feedbackUnreadCount } = useFeedback();
  const unreadState = getUnreadMessageState(
    conversations,
    momentUnreadCount + blogUnreadCount + feedbackUnreadCount,
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: colors.background,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarButton: HapticTab,
        tabBarStyle: {
          alignSelf: 'center',
          backgroundColor: colors.card,
          borderTopColor: colors.line,
          height: appLayout.tabBarHeight,
          maxWidth: appLayout.screenMaxWidth,
          paddingBottom: 10,
          paddingTop: 10,
          width: '100%',
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          href: null,
          title: '工具',
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          tabBarAccessibilityLabel: unreadState.accessibilityLabel,
          title: '消息',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.messageIcon}>
              <Ionicons
                name={focused ? 'chatbubble' : 'chatbubble-outline'}
                size={23}
                color={color}
              />
              {unreadState.hasUnread ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.unreadDot, { borderColor: colors.card }]}
                  testID="messages-unread-dot"
                />
              ) : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person-circle' : 'person-circle-outline'}
              size={25}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  messageIcon: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  unreadDot: {
    backgroundColor: '#f04444',
    borderRadius: 5,
    borderWidth: 1.5,
    height: 9,
    pointerEvents: 'none',
    position: 'absolute',
    right: -1,
    top: -2,
    width: 9,
  },
});
