const fs = require('fs');
const file = 'src/screens/ProfileScreen.js';
let c = fs.readFileSync(file, 'utf8');

const startMatch = "          {canUseSpotify && (\n            \n          {canUseSpotify && (";
const endMatch = '          <Card style={styles.formCard}>\n            <SectionToggleHeader\n              colors={colors}\n              expanded={expandedSection === \'basic\'}';

const startIndex = c.indexOf("          {canUseSpotify && (\n            \n          {canUseSpotify && (");
if (startIndex !== -1) {
  const endIndex = c.indexOf(endMatch, startIndex);
  if (endIndex !== -1) {
    const goodSpotify = `
          {canUseSpotify && (
            <Card style={styles.formCard}>
              <SectionToggleHeader
                colors={colors}
                expanded={true}
                icon="music.note"
                title="เพลงโปรด (Spotify)"
              />
              <View style={{ padding: 16 }}>
                <Pressable
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.surfaceRaised,
                    padding: 12,
                    borderRadius: 16,
                  }}
                  onPress={() => {
                    if (favoriteTracks.length < MAX_FAVORITE_TRACKS) {
                      setShowSpotifySearch(true);
                    } else {
                      onToast?.('คุณเพิ่มเพลงโปรดครบ ' + MAX_FAVORITE_TRACKS + ' เพลงแล้ว', 'info');
                    }
                  }}
                >
                  <FeatureIcon name="search" size={20} color={colors.inkSoft} style={{ marginRight: 8 }} />
                  <Text style={{ color: colors.inkMuted, flex: 1 }}>
                    {favoriteTracks.length > 0
                      ? 'เพิ่มเพลงโปรด...'
                      : 'ค้นหาและเพิ่มเพลงจาก Spotify'}
                  </Text>
                </Pressable>
                
                {favoriteTracks.length > 0 && (
                  <View style={{ marginTop: 16, gap: 12 }}>
                    {favoriteTracks.map((track) => (
                      <View key={track.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {track.album?.images?.[0] ? (
                          <Image source={{ uri: track.album.images[0].url }} style={{ width: 48, height: 48, borderRadius: 8 }} />
                        ) : (
                          <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: colors.surfaceRaised, justifyContent: 'center', alignItems: 'center' }}>
                            <FeatureIcon name="music.note" size={24} color={colors.inkSoft} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{track.name}</Text>
                          <Text style={{ color: colors.inkMuted, fontSize: 12 }} numberOfLines={1}>{Array.isArray(track.artists) ? track.artists.map(a => a.name).join(', ') : (typeof track.artists === 'string' ? track.artists : (track.artist || 'Unknown'))}</Text>
                        </View>
                        <Pressable onPress={() => {
                          const newTracks = favoriteTracks.filter(t => t.id !== track.id);
                          setFavoriteTracks(newTracks);
                        }} style={{ padding: 8 }}>
                          <FeatureIcon name="trash" size={20} color={colors.danger} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </Card>
          )}
`;
    
    c = c.slice(0, startIndex) + goodSpotify + c.slice(endIndex);
    fs.writeFileSync(file, c);
    console.log("Fixed!");
  }
}

