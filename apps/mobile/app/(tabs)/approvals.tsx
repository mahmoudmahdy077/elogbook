import { View, Text, ScrollView } from 'react-native';

export default function ApprovalsScreen() {
  return (
    <ScrollView className="flex-1 bg-black px-4 pt-4">
      <Text className="text-white text-2xl font-bold mb-6">Approvals</Text>
      <View className="bg-gray-900 rounded-xl p-6 border border-gray-800 items-center">
        <Text className="text-gray-400">No pending approvals.</Text>
      </View>
    </ScrollView>
  );
}
