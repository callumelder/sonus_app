import { Ionicons } from '@expo/vector-icons';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Audio } from 'expo-av';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, SafeAreaView, StyleSheet, TouchableOpacity, View } from 'react-native';
import SignInOverlay from '../components/signinoverlay';
import { supabase } from '../utils/supabase';

const VoiceInterface = () => {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const meterInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const lastProcessedSize = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  // const soundRef = useRef<Audio.Sound | null>(null);
  const [isFinal, setIsFinal] = useState(false);
  
  // State for the audio queue
  const [audioQueue, setAudioQueue] = useState<Array<any>>([]);
  const [isPlayingQueue, setIsPlayingQueue] = useState(false);
  const currentlyPlaying = useRef<Audio.Sound | null>(null);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const WEBSOCKET_URL = process.env.EXPO_PUBLIC_WEBSOCKET_URL;

  if (!WEBSOCKET_URL) {
    throw new Error('Missing WebSocket URL. Please check your .env file for EXPO_PUBLIC_WEBSOCKET_URL.');
  }

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setIsAuthenticated(true);
      } else {
        setShowSignIn(true);
      }
    };
    
    checkAuth();
  }, []);

  const handleSignInSuccess = () => {
    setIsAuthenticated(true);
    setShowSignIn(false);
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    const initializeWebSocket = async () => {
      // Get the current session and access token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        console.error('No access token available');
        return;
      }

      GoogleSignin.configure({
        scopes: [
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/contacts.readonly"
        ],
        iosClientId: '896784116400-qemrmrjd9cte2jgslso13hav95r6p06f.apps.googleusercontent.com',
      })

      const tokens = await GoogleSignin.getTokens()

      ws.current = new WebSocket(WEBSOCKET_URL);

      ws.current.onopen = () => {
        console.log('WebSocket Connected');
        
        // Send authentication info first, then start conversation (same as before)
        if (ws.current?.readyState === WebSocket.OPEN) {
          console.log("Sending auth to back-end")
          ws.current.send(JSON.stringify({
            type: "authenticate",
            token: tokens.accessToken,
            user: {
              id: session.user.id,
              email: session.user.email,
              name: session.user.user_metadata?.full_name || session.user.email
            }
          }));

          ws.current.send(JSON.stringify({
            type: "start_conversation"
          }));
        }
      };

      ws.current.onclose = () => {
        console.log('WebSocket Disconnected');
        setIsListening(false);
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket Error:', error);
        setIsListening(false);
        if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
          ws.current.close();
        }
      };

      // Keep your existing onmessage handler exactly as it was
      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // if (data.type === 'audio_response') {
          //   console.log(`[WebSocket] Received ${data.type}, size: ${data.size || 'unknown'}`);
          // } else {
          //   console.log('[WebSocket] Received:', data);
          // }
          
          switch (data.type) {
            case "start_listening":
              console.log('[WebSocket] Received command to start listening');
              startRecording();
              break;
              
            case "stop_listening":
              console.log('[WebSocket] Received command to stop listening');
              stopRecording();
              stopSpeechProcessor();
              break;
              
            case "audio_chunk":
              // Handle legacy single-response format
              if (data.data && data.data.length > 0) {
                handleAudioChunk(data);
              }
              break;

            case "audio_complete":
              // Set audio complete
              setIsFinal(true);
              break;
          }
        } catch (error) {
          console.error('[WebSocket] Error processing message:', error);
        }
      };
    };

    // Call the async function
    initializeWebSocket();

    // Cleanup when component unmounts
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [isAuthenticated]);

  // Initialise audio
  useEffect(() => {
    if (!isAuthenticated) return;

    // Request permissions and start recording when component mounts
    const initializeAudio = async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.error('Permission to access microphone was denied');
        return;
      }
      console.log('Microphone permissions granted');
    };

    initializeAudio();
  }, [isAuthenticated])

  // Initialise animation
  useEffect(() => {
    const startPulseAnimation = () => {
      // Stop existing animation if any
      if (pulseAnimation.current) {
        pulseAnimation.current.stop();
      }

      // Reset to initial value
      pulseAnim.setValue(1);

      // Create new pulse animation sequence
      pulseAnimation.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          })
        ])
      );
    
      // Start the animation
      pulseAnimation.current.start();
    };

    // Start pulsing animation
    startPulseAnimation();

    return () => {
      if (pulseAnimation.current) {
        pulseAnimation.current.stop();
      }
    };
  }, [])

  // Update recordingRef whenever recording state changes
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // Start listening
  useEffect(() => {
    if (isFinal === true) {
      startRecording();
      setIsFinal(false);
    }
  }, [isFinal]);

  useEffect(() => {
    // Only set up processing if there are chunks and we're not already processing
    if (audioQueue.length > 0 && !isPlayingQueue) {
      
      // Clear any existing timeout
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      
      // Set a debounced timeout to batch chunks
      processingTimeoutRef.current = setTimeout(() => {
        if (audioQueue.length > 0 && !isPlayingQueue) {
          console.log(`[Audio Queue] Processing batched ${audioQueue.length} chunks`);
          processAudioQueue();
        }
      }, 200); // Wait 200ms for more chunks to arrive
    }
  }, [audioQueue, isPlayingQueue]);

  const setAudioModeForRecording = async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
  };

  const setAudioModeForPlayback = async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: true,
    });
  };

  // Play a single audio chunk
  const playAudioChunk = async (audioData: any): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Stop any currently playing audio
        if (currentlyPlaying.current) {
          await currentlyPlaying.current.unloadAsync();
          currentlyPlaying.current = null;
        }

        // Create URI from base64 data
        const uri = `data:audio/${audioData.format};base64,${audioData.data}`;

        // Create and play the sound
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true },
          (status) => {
            if (!status.isLoaded) return;

            if (status.didJustFinish) {
              console.log('[Audio Queue] Chunk finished playing');
              // Clean up
              if (currentlyPlaying.current) {
                currentlyPlaying.current.unloadAsync();
                currentlyPlaying.current = null;
              }
              resolve(); // Resolve the promise when done
            }
          }
        );

        currentlyPlaying.current = sound;
        setIsPlaying(true);

      } catch (error) {
        console.error('[Audio Queue] Error playing chunk:', error);
        reject(error);
      }
    });
  };

  // Process the queue sequentially
  const processAudioQueue = async () => {
    if (isPlayingQueue) {
      console.log('[Audio Queue] Already processing queue, skipping');
      return;
    }

    console.log(`[Audio Queue] Starting to process ${audioQueue.length} chunks`);
    setIsPlayingQueue(true);

    // Create a copy of the queue and clear the original
    const queueToProcess = [...audioQueue];
    setAudioQueue([]);

    try {
      // Play each chunk sequentially
      for (let i = 0; i < queueToProcess.length; i++) {
        const chunk = queueToProcess[i];
        console.log(`[Audio Queue] Playing chunk ${i + 1}/${queueToProcess.length}`);
        
        await playAudioChunk(chunk);
      }

      console.log('[Audio Queue] Finished processing all chunks');

    } catch (error) {
      console.error('[Audio Queue] Error processing queue:', error);
    } finally {
      setIsPlayingQueue(false);
      setIsPlaying(false);
    }
  };

  // Add chunks to the queue
  const addToAudioQueue = (audioData: any) => {
    console.log(`[Audio Queue] Adding chunk: ${audioData.size} bytes`);
    setAudioQueue(prev => [...prev, audioData]);
  };

  // Clear the queue
  const clearAudioQueue = () => {
    console.log('[Audio Queue] Clearing queue');
    setAudioQueue([]);
    setIsPlayingQueue(false);
    
    // Clear any pending processing timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
    
    // Stop any currently playing audio
    if (currentlyPlaying.current) {
      currentlyPlaying.current.unloadAsync();
      currentlyPlaying.current = null;
    }
  };

  // Handle incoming audio chunks
  const handleAudioChunk = (data: { 
    format: string, 
    data: string, 
    size: number, 
    is_final?: boolean 
  }) => {
    console.log(`[Audio Queue] Received chunk: ${data.size} bytes`);
    addToAudioQueue(data);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAudioQueue();
    };
  }, []);

  // // Handle incoming audio from the backend
  // const handleAudioResponse = async (data: { 
  //   data: string, 
  //   format: string, 
  //   size?: number, 
  //   intermediate_response?: boolean 
  // }) => {
  //   try {
  //     if (data.intermediate_response) {
  //       waitForFinalResponse.current = true;
  //     }
  //     else {
  //       waitForFinalResponse.current = false;
  //     }
  //     // If we're already playing something, we should unload it first
  //     if (soundRef.current) {
  //       await soundRef.current.unloadAsync();
  //       soundRef.current = null;
  //     }
      
  //     // Decode base64 data
  //     const base64Audio = data.data;
  //     const uri = `data:audio/${data.format};base64,${base64Audio}`;
      
  //     console.log(`[Audio] Creating sound from ${data.size || 'unknown'} bytes of data`);
      
  //     // Create and load the new sound
  //     const { sound } = await Audio.Sound.createAsync(
  //       { uri },
  //       { shouldPlay: true },
  //       (status) => {
  //         // Handle playback status updates
  //         if (!status.isLoaded) {
  //           return;
  //         }
          
  //         if (status.didJustFinish) {
  //           setIsPlaying(false);
            
  //           // Send completion notification to backend if requested
  //           if (waitForFinalResponse.current === false && ws.current?.readyState === WebSocket.OPEN) {
  //             console.log('[Audio] Sending playback completion notification');
  //             ws.current.send(JSON.stringify({
  //               type: 'playback_completed'
  //             }));
  //           }
            
  //           // Clean up after playback
  //           if (soundRef.current) {
  //             soundRef.current.unloadAsync();
  //             soundRef.current = null;
  //           }
  //         }
  //       }
  //     );
      
  //     // Store reference and update UI
  //     soundRef.current = sound;
  //     setIsPlaying(true);
      
  //     console.log('[Audio] Started playback');
      
  //   } catch (error) {
  //     console.error('[Audio] Error playing audio:', error);
      
  //     // Send completion notification even on error if requested
  //     if (ws.current?.readyState === WebSocket.OPEN) {
  //       ws.current.send(JSON.stringify({
  //         type: 'playback_completed'
  //       }));
  //     }
  //   }
  // };

  const startRecording = async () => {
    try {
      // If already listening/recording, don't try to start again
      if (isListening) {
        console.log('[Recording] Recording already in progress, ignoring start request');
        return;
      }
      
      // Set listening state right away to prevent concurrent attempts
      setIsListening(true);
  
      // Make sure any existing recording is stopped first
      // await stopRecording(); // Pass false to not reset isListening
      
      // Small delay to ensure clean state
      await new Promise(resolve => setTimeout(resolve, 300));

      // Reset the processed size counter
      lastProcessedSize.current = 0;
  
      // Set audio mode for recording
      await setAudioModeForRecording();
  
      console.log('[Recording] Starting new recording...');
      const { recording: recorderInstance } = await Audio.Recording.createAsync(
        {
          android: {
            extension: '.wav',
            outputFormat: Audio.AndroidOutputFormat.DEFAULT,
            audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 16000 * 16,
          },
          ios: {
            extension: '.wav',
            outputFormat: Audio.IOSOutputFormat.LINEARPCM,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: 16000,
            numberOfChannels: 1,
            bitRate: 16000 * 16,
          },
          web: {
            mimeType: 'audio/wav',
            bitsPerSecond: 16000 * 16,
          },
        }
      );
      
      setRecording(recorderInstance);
      console.log('[Recording] Recording instance created');
  
      // Start sending audio data in intervals
      meterInterval.current = setInterval(async () => {
        // Use recordingRef to access the current recording value
        if (recordingRef.current && ws.current?.readyState === WebSocket.OPEN) {
          try {
            const uri = recordingRef.current.getURI();
            if (uri) {
              const response = await fetch(uri);
              const fullAudioData = await response.arrayBuffer();
              
              // Only send the new portion of the audio
              if (fullAudioData.byteLength > lastProcessedSize.current) {
                const newAudioData = fullAudioData.slice(lastProcessedSize.current);
                console.log(`[WebSocket] Sending new audio chunk: ${newAudioData.byteLength} bytes`);
                
                ws.current.send(JSON.stringify({
                  type: 'audio_data',
                  chunk: Array.from(new Uint8Array(newAudioData))
                }));

                lastProcessedSize.current = fullAudioData.byteLength;
              }
            }
          } catch (error) {
            console.error('[WebSocket] Error sending audio:', error);
          }
        }
      }, 100);
  
    } catch (err) {
      console.error('[Recording] Failed to start:', err);
      // Reset the listening state if we failed to start
      setIsListening(false);
    }
  };

  const stopRecording = async () => {
    try {
      console.log('stopRecording called, recording ref:', recordingRef.current);
      
      // Clear interval first to stop sending audio data
      if (meterInterval.current) {
        clearInterval(meterInterval.current);
        meterInterval.current = null;
      }
      
      // Check recordingRef instead of recording state
      if (recordingRef.current) {
        console.log('Stopping recording instance...');
        await recordingRef.current.stopAndUnloadAsync();
        setRecording(null);
        lastProcessedSize.current = 0;  // Reset the counter
      }

      // Set audio mode for playback
      await setAudioModeForPlayback()

    } catch (err) {
      console.error('Failed to stop recording', err);
    } finally {
      setIsListening(false);
    }
  };

  const stopSpeechProcessor = async () => {
    // Send completion notification even on error if requested
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'stop_processor'
      }));
    }
  }

  const toggleMute = async () => {
    if (isMuted) {
      await startRecording();
    } else {
      await stopRecording();
    }
    setIsMuted(!isMuted);
  };

  // Don't render the main interface until authenticated
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <SignInOverlay 
          visible={showSignIn} 
          onSignInSuccess={handleSignInSuccess} 
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.orbContainer}>
        <Animated.View 
          style={[
            styles.orb,
            {
              transform: [{ scale: pulseAnim }],
              backgroundColor: isPlaying ? '#4CAF50' : '#60A5FA',
              shadowColor: isPlaying ? '#4CAF50' : '#60A5FA'
            }
          ]}
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[
            styles.button,
            isMuted && styles.activeButton
          ]} 
          onPress={toggleMute}
        >
          <Ionicons 
            name={isMuted ? "mic-off" : "mic"} 
            size={32} 
            color="white" 
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.button}>
          <Ionicons name="options" size={32} color="white" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  orbContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orb: {
    width: 128,
    height: 128,
    borderRadius: 64,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 10,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
    paddingBottom: 64,
  },
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#27272A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeButton: {
    backgroundColor: 'grey',
  },
  meterText: {
    color: 'white',
    marginTop: 16,
    fontSize: 16,
  },
});

export default VoiceInterface;