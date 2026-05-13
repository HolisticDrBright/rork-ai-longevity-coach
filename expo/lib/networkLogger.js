import React from 'react';
import { View } from 'react-native';
import NetworkLogger from 'react-native-network-logger';

export default function NetworkLog() {
  return (
    <View style={{ flex: 1 }}>
       {__DEV__ && <NetworkLogger />}
    </View>
  )
}