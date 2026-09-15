import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoSendJobs, retryVideoSend, dismissVideoSend } from '../services/videoSendQueue';

export default function VideoSendStatus({ conversationId, userId }) {
  const jobs = useVideoSendJobs().filter(job => job.conversationId === conversationId && job.userId === userId);
  return jobs.map(job => <View key={job.id} style={{ padding: 12, margin: 8, borderRadius: 16, backgroundColor: '#182235' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {job.status === 'failed' ? <Ionicons name="alert-circle-outline" color="#ffb4ab" size={24} /> : <ActivityIndicator color="#fff" />}
      <Text style={{ color: '#fff', flex: 1 }}>วิดีโอ · {job.status === 'failed' ? job.error : job.phase}</Text>
    </View>
    {job.status === 'failed' && <View style={{ flexDirection: 'row', gap: 24, marginTop: 12 }}>
      <Pressable onPress={() => retryVideoSend(job.id)}><Text style={{ color: '#a9c7ff', padding: 8 }}>ลองส่งใหม่</Text></Pressable>
      <Pressable onPress={() => dismissVideoSend(job.id)}><Text style={{ color: '#ddd', padding: 8 }}>ยกเลิก</Text></Pressable>
    </View>}
  </View>);
}
