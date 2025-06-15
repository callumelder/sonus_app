import React, { useEffect, useState } from 'react'
import { Animated, Modal, StyleSheet, View } from 'react-native'
import { supabase } from '../utils/supabase'
import GoogleAuth from './googleauth'

interface SignInOverlayProps {
  visible: boolean
  onSignInSuccess: () => void
}

export default function SignInOverlay({ visible, onSignInSuccess }: SignInOverlayProps) {
  const [fadeAnim] = useState(new Animated.Value(0))

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start()
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start()
    }
  }, [visible])

  // Listen for auth changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        console.log('User signed in successfully!')
        onSignInSuccess()
      }
    })

    return () => subscription.unsubscribe()
  }, [onSignInSuccess])

  if (!visible) return null

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
    >
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <View style={styles.container}>
          <GoogleAuth />
        </View>
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: 'white',
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 280,
  },
})