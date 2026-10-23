import React from 'react';
import { StyleSheet, View } from 'react-native';
import Text from '../AppText';
import FeatureIcon from '../FeatureIcon';
import { useTheme } from '../../theme';

/** Section heading with an optional tinted icon and a short trailing note. */
export default function ActivitySectionTitle({ icon, iconColor, title, subtitle, trailing }) {
  const { colors } = useTheme();
  const tint = iconColor || colors.primary;
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <View style={styles.titleLine}>
          {icon ? (
            <View style={[styles.icon, { backgroundColor: `${tint}22` }]}>
              <FeatureIcon color={tint} name={icon} size={14} />
            </View>
          ) : null}
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
        </View>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={[styles.trailing, { color: colors.accentText }]}>{trailing}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-end', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  titles: { flex: 1, gap: 3, minWidth: 0 },
  titleLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  icon: { alignItems: 'center', borderRadius: 10, height: 28, justifyContent: 'center', width: 28 },
  title: { flexShrink: 1, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  trailing: { fontSize: 13, fontWeight: '700', paddingBottom: 2 },
});
