import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ExportModel } from './meetingExport';
import { toPdfText } from './pdfText';

// react-pdf hyphenates by default, which splits names ("Alan Tur-ing") and
// reads like a typesetting error in minutes. Whole words only.
Font.registerHyphenationCallback((word) => [word]);

/**
 * The minutes as a PDF, laid out with `@react-pdf/renderer`.
 *
 * Declarative layout rather than drawing text at coordinates: wrapping,
 * pagination and a footer repeated on every page come from the library, so a
 * two-hour transcript flows across pages without any arithmetic here. Uses
 * the PDF's built-in Helvetica, which needs no font file download; see
 * `toPdfText` for what that costs.
 */

const INK = '#1f2328';
const MUTED = '#5b6270';
const RULE = '#e3e5e8';
const ACCENT = '#3b36b5';

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 60,
    paddingHorizontal: 50,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    lineHeight: 1.45,
    color: INK,
  },
  brand: { fontSize: 8, color: MUTED, letterSpacing: 1.2, marginBottom: 8 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 20, lineHeight: 1.2, marginBottom: 6 },
  description: { color: MUTED, marginBottom: 10 },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: RULE,
    paddingTop: 8,
    paddingBottom: 4,
    marginBottom: 6,
  },
  metaItem: { width: '50%', marginBottom: 6, paddingRight: 8 },
  metaLabel: { fontSize: 7.5, color: MUTED, letterSpacing: 0.8, marginBottom: 1 },
  heading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12.5,
    color: ACCENT,
    marginTop: 16,
    marginBottom: 6,
  },
  paragraph: { marginBottom: 4 },
  row: { flexDirection: 'row', marginBottom: 4 },
  bullet: { width: 12, color: MUTED },
  box: { width: 8, height: 8, borderWidth: 1, borderColor: MUTED, marginTop: 3, marginRight: 8 },
  boxDone: { backgroundColor: MUTED },
  grow: { flex: 1 },
  done: { color: MUTED, textDecoration: 'line-through' },
  detail: { fontSize: 9, color: MUTED },
  time: { width: 42, fontFamily: 'Courier', fontSize: 9, color: MUTED, paddingTop: 1 },
  speaker: { fontFamily: 'Helvetica-Bold' },
  note: { marginTop: 18, fontSize: 8.5, color: MUTED },
  // The meeting's title on every page, as an absolutely positioned `fixed`
  // Text - the form react-pdf repeats per page. (A fixed View wrapping it was
  // silently never drawn. Page numbers were dropped for the same reason: in
  // react-pdf 4.9 a `render`-prop Text is laid out but never painted, even
  // in the library's own documented form - checked by exporting and viewing.)
  footer: { position: 'absolute', bottom: 26, left: 50, right: 50, fontSize: 8, color: MUTED },
});

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label.toUpperCase()}</Text>
      <Text>{toPdfText(value)}</Text>
    </View>
  );
}

export function MeetingPdf({ model }: { model: ExportModel }) {
  const title = toPdfText(model.title);

  return (
    <Document
      title={title}
      subject="Meeting minutes"
      author="IntellMeet"
      creator="IntellMeet"
      producer="IntellMeet"
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>INTELLMEET · MEETING MINUTES</Text>
        <Text style={styles.title}>{title}</Text>
        {model.description && (
          <Text style={styles.description}>{toPdfText(model.description)}</Text>
        )}

        <View style={styles.meta}>
          <Meta label="When" value={model.when} />
          {model.duration && <Meta label="Duration" value={model.duration} />}
          <Meta label="Host" value={model.host} />
          <Meta label="Participants" value={model.participants.join(', ')} />
        </View>

        {model.summary && (
          <View>
            <Text style={styles.heading}>Summary</Text>
            {model.summary.split(/\n{2,}/).map((paragraph, index) => (
              <Text key={index} style={styles.paragraph}>
                {toPdfText(paragraph)}
              </Text>
            ))}
          </View>
        )}

        {model.decisions.length > 0 && (
          <View>
            <Text style={styles.heading}>Key decisions</Text>
            {model.decisions.map((decision, index) => (
              <View key={index} style={styles.row} wrap={false}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.grow}>{toPdfText(decision)}</Text>
              </View>
            ))}
          </View>
        )}

        {model.actionItems.length > 0 && (
          <View>
            <Text style={styles.heading}>Action items</Text>
            {model.actionItems.map((item, index) => {
              const details = [
                item.owner
                  ? `${item.owner}${item.ownerUnmatched ? ' (not a participant)' : ''}`
                  : 'Unassigned',
                item.due ? `due ${item.due}` : null,
                item.done ? 'done' : null,
              ].filter(Boolean);

              return (
                <View key={index} style={styles.row} wrap={false}>
                  {/* Drawn, not a glyph: Helvetica has no checkbox character. */}
                  <View style={item.done ? [styles.box, styles.boxDone] : styles.box} />
                  <View style={styles.grow}>
                    <Text style={item.done ? styles.done : undefined}>{toPdfText(item.text)}</Text>
                    <Text style={styles.detail}>{toPdfText(details.join(' · '))}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {model.transcript.length > 0 && (
          <View>
            {/* Kept with its first line, so the heading never ends a page. */}
            <Text style={styles.heading} minPresenceAhead={40}>
              Transcript
            </Text>
            {model.transcript.map((line, index) => (
              // Never split a line from its timestamp across a page break.
              <View key={index} style={styles.row} wrap={false}>
                <Text style={styles.time}>{line.at}</Text>
                <Text style={styles.grow}>
                  {line.speaker && <Text style={styles.speaker}>{toPdfText(line.speaker)}: </Text>}
                  {toPdfText(line.text)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {model.provenance && (
          <Text style={styles.note}>
            {toPdfText(
              `${model.provenance}.${model.aiGenerated ? ' AI output can be wrong; check owners and dates.' : ''}`,
            )}
          </Text>
        )}

        <Text style={styles.footer} fixed>
          {title} · IntellMeet minutes
        </Text>
      </Page>
    </Document>
  );
}
