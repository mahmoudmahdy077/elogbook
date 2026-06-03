import { View, Text } from 'react-native';

export default function AppIndex() {
  return (
    <View className="flex-1 bg-black items-center justify-center">
      <Text className="text-white text-2xl font-bold">E-Logbook</Text>
      <Text className="text-gray-400 mt-2">Loading...</Text>
    </View>
  );
}
