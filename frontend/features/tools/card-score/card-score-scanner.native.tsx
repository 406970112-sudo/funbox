import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';

type ScannerProps = {
  onClose: () => void;
  onDetected: (value: string) => void;
  onManualEntry: () => void;
};

export function CardScoreScanner({ onClose, onDetected, onManualEntry }: ScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const handledRef = useRef(false);
  const granted = permission?.granted === true;
  const denied = permission != null && !permission.granted && !permission.canAskAgain;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topbar}>
        <Pressable
          accessibilityLabel="关闭扫码"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.iconButton}>
          <MaterialCommunityIcons name="close" color="#ffffff" size={22} />
        </Pressable>
        <ThemedText style={styles.title}>扫描房间二维码</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onManualEntry}
          style={styles.manualButton}>
          <ThemedText style={styles.manualButtonText}>输入房间码</ThemedText>
        </Pressable>
      </View>

      <View style={styles.cameraShell}>
        {granted ? (
          <CameraView
            active
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            enableTorch={torch}
            facing="back"
            onBarcodeScanned={({ data }) => {
              if (handledRef.current) return;
              handledRef.current = true;
              onDetected(data);
            }}
            style={styles.camera}
          />
        ) : (
          <View style={styles.centerState}>
            <MaterialCommunityIcons
              name={denied ? 'camera-off-outline' : 'qrcode-scan'}
              color="#ffffff"
              size={36}
            />
            <ThemedText style={styles.stateText}>
              {denied ? '相机权限未开启，可在系统设置中开启后重试' : '需要相机权限才能扫码加入'}
            </ThemedText>
            {!denied ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void requestPermission()}
                style={styles.permissionButton}>
                <ThemedText style={styles.permissionButtonText}>开启相机权限</ThemedText>
              </Pressable>
            ) : null}
          </View>
        )}
        <View pointerEvents="none" style={styles.viewfinder}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      <ThemedText style={styles.hint}>将房主手机上的二维码放入框内</ThemedText>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="切换手电筒"
          accessibilityRole="button"
          onPress={() => setTorch((value) => !value)}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons
            name={torch ? 'flashlight' : 'flashlight-off'}
            color="#ffffff"
            size={20}
          />
          <ThemedText style={styles.actionLabel}>{torch ? '关闭手电' : '手电筒'}</ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  actions: {
    alignItems: 'center',
    paddingBottom: 18,
    paddingTop: 6,
  },
  camera: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  cameraShell: {
    backgroundColor: '#0d1420',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  centerState: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 28,
  },
  corner: {
    borderColor: '#c9f36a',
    height: 26,
    position: 'absolute',
    width: 26,
  },
  cornerBL: {
    borderBottomLeftRadius: 8,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 14,
    left: 14,
  },
  cornerBR: {
    borderBottomRightRadius: 8,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 14,
    right: 14,
  },
  cornerTL: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 8,
    borderTopWidth: 3,
    left: 14,
    top: 14,
  },
  cornerTR: {
    borderRightWidth: 3,
    borderTopRightRadius: 8,
    borderTopWidth: 3,
    right: 14,
    top: 14,
  },
  hint: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 16,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  manualButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 4,
  },
  manualButtonText: {
    color: '#c9f36a',
    fontSize: 12,
    fontWeight: '800',
  },
  permissionButton: {
    backgroundColor: '#c9f36a',
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: 20,
  },
  permissionButtonText: {
    color: '#151b3b',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 44,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  root: {
    backgroundColor: '#0d1420',
    flex: 1,
  },
  stateText: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
  },
  title: {
    color: '#ffffff',
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  viewfinder: {
    alignSelf: 'center',
    height: 210,
    position: 'absolute',
    width: '72%',
  },
});
