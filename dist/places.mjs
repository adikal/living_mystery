// A place named mid-sentence ("reaches the post office", "at the village square"): the setting's own phrase when it
// gives one (`called`), otherwise its name with a leading "The" in lower case. One rule for every text that names a place.
export const inSentence = place => place?.called ?? String(place?.name ?? 'the village').replace(/^The /, 'the ');
