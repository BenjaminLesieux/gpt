//! Rust port of `normalizeGp` from `@gpt/gpt-core`, kept here so the commit
//! pipeline never depends on a live webview.
//!
//! Guitar Pro stamps the save time into every zip header, so bytes change even
//! when no note did. Rebuilding deterministically — entries sorted, stored
//! uncompressed, DOS timestamps zeroed — makes "no musical change" mean "no
//! new version". Payloads are copied byte for byte.

use std::io::{Cursor, Read, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

const LOCAL_HEADER_SIG: u32 = 0x0403_4b50; // PK\x03\x04
const EMPTY_ARCHIVE_SIG: u32 = 0x0605_4b50; // PK\x05\x06 (EOCD only)
const CENTRAL_HEADER_SIG: u32 = 0x0201_4b50; // PK\x01\x02
const EOCD_SIG: [u8; 4] = [0x50, 0x4b, 0x05, 0x06];

/// Non-zip input (legacy binary `.gp5`) and unparseable input pass through:
/// normalization is an optimisation, never a reason to lose a save.
pub fn normalize_gp(bytes: &[u8]) -> Vec<u8> {
    if !is_zip(bytes) {
        return bytes.to_vec();
    }

    match rebuild(bytes) {
        Ok(normalized) => normalized,
        Err(err) => {
            eprintln!("[gitarpro] normalization skipped ({err}); storing raw bytes");
            bytes.to_vec()
        }
    }
}

/// False only for a zip-signature file whose directory won't read — i.e. one
/// still being written.
pub fn is_intact(bytes: &[u8]) -> bool {
    !is_zip(bytes) || ZipArchive::new(Cursor::new(bytes)).is_ok()
}

fn rebuild(bytes: &[u8]) -> Result<Vec<u8>, zip::result::ZipError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;

    let mut entries: Vec<(String, Option<Vec<u8>>)> = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_owned();
        if entry.is_dir() {
            entries.push((name, None));
            continue;
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut data)?;
        entries.push((name, Some(data)));
    }

    entries.sort_by(|(left, _), (right, _)| left.cmp(right));

    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .last_modified_time(DateTime::default())
        .unix_permissions(0o644)
        .large_file(false);

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        match data {
            Some(data) => {
                writer.start_file(name, options)?;
                writer.write_all(&data)?;
            }
            None => writer.add_directory(name, options)?,
        }
    }

    let mut out = writer.finish()?.into_inner();
    scrub_timestamps(&mut out);
    Ok(out)
}

fn is_zip(bytes: &[u8]) -> bool {
    let Some(head) = bytes.get(..4) else {
        return false;
    };
    let signature = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    signature == LOCAL_HEADER_SIG || signature == EMPTY_ARCHIVE_SIG
}

/// Zip writers encode the DOS date/time fields from *local* time, so the same
/// content normalized in two timezones would otherwise differ. Walks the
/// central directory rather than scanning for signatures, which would risk
/// hitting payload bytes that look like a header.
fn scrub_timestamps(buf: &mut [u8]) {
    let Some(eocd) = find_eocd(buf) else { return };

    let entry_count = read_u16(buf, eocd + 10) as usize;
    let mut cursor = read_u32(buf, eocd + 16) as usize;

    for _ in 0..entry_count {
        if cursor + 46 > buf.len() || read_u32(buf, cursor) != CENTRAL_HEADER_SIG {
            return;
        }

        // Central-directory record: time @ +12, date @ +14, local offset @ +42.
        write_u16(buf, cursor + 12, 0);
        write_u16(buf, cursor + 14, 0);

        let local = read_u32(buf, cursor + 42) as usize;
        if local + 14 <= buf.len() && read_u32(buf, local) == LOCAL_HEADER_SIG {
            // Local file header: time @ +10, date @ +12.
            write_u16(buf, local + 10, 0);
            write_u16(buf, local + 12, 0);
        }

        let name_len = read_u16(buf, cursor + 28) as usize;
        let extra_len = read_u16(buf, cursor + 30) as usize;
        let comment_len = read_u16(buf, cursor + 32) as usize;
        cursor += 46 + name_len + extra_len + comment_len;
    }
}

/// EOCD sits in the last 22 bytes plus an optional trailing comment.
fn find_eocd(buf: &[u8]) -> Option<usize> {
    if buf.len() < 22 {
        return None;
    }
    (0..=buf.len() - 22)
        .rev()
        .find(|&at| buf[at..at + 4] == EOCD_SIG)
}

fn read_u16(buf: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([buf[at], buf[at + 1]])
}

fn read_u32(buf: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]])
}

fn write_u16(buf: &mut [u8], at: usize, value: u16) {
    buf[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A zip whose entries carry the given order, timestamp and compression —
    /// i.e. all the things two Guitar Pro saves of the same score differ by.
    fn zip_with(entries: &[(&str, &[u8])], time: DateTime, method: CompressionMethod) -> Vec<u8> {
        let options = SimpleFileOptions::default()
            .compression_method(method)
            .last_modified_time(time);

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn entries_of(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        (0..archive.len())
            .map(|index| {
                let mut entry = archive.by_index(index).unwrap();
                let name = entry.name().to_owned();
                let mut data = Vec::new();
                entry.read_to_end(&mut data).unwrap();
                (name, data)
            })
            .collect()
    }

    const SCORE: &[u8] = b"<GPIF><Score><Title>Riff</Title></Score></GPIF>";
    const VERSION: &[u8] = b"7.0";

    #[test]
    fn two_saves_of_the_same_content_normalize_identically() {
        let monday = zip_with(
            &[("Content/score.gpif", SCORE), ("VERSION", VERSION)],
            DateTime::from_date_and_time(2026, 3, 2, 9, 30, 0).unwrap(),
            CompressionMethod::Deflated,
        );
        // Same music, saved later, entries written in the other order and
        // stored rather than deflated.
        let friday = zip_with(
            &[("VERSION", VERSION), ("Content/score.gpif", SCORE)],
            DateTime::from_date_and_time(2026, 3, 6, 18, 4, 12).unwrap(),
            CompressionMethod::Stored,
        );

        assert_ne!(monday, friday, "fixture should differ before normalizing");
        assert_eq!(normalize_gp(&monday), normalize_gp(&friday));
    }

    #[test]
    fn a_real_content_change_still_produces_different_bytes() {
        let before = zip_with(
            &[("Content/score.gpif", SCORE)],
            DateTime::default(),
            CompressionMethod::Deflated,
        );
        let after = zip_with(
            &[(
                "Content/score.gpif",
                b"<GPIF><Score><Title>Riff II</Title></Score></GPIF>".as_slice(),
            )],
            DateTime::default(),
            CompressionMethod::Deflated,
        );

        assert_ne!(normalize_gp(&before), normalize_gp(&after));
    }

    #[test]
    fn normalization_is_idempotent_and_preserves_payloads() {
        let original = zip_with(
            &[("Content/score.gpif", SCORE), ("VERSION", VERSION)],
            DateTime::from_date_and_time(2026, 3, 2, 9, 30, 0).unwrap(),
            CompressionMethod::Deflated,
        );

        let once = normalize_gp(&original);
        assert_eq!(once, normalize_gp(&once));

        assert_eq!(
            entries_of(&once),
            vec![
                ("Content/score.gpif".to_owned(), SCORE.to_vec()),
                ("VERSION".to_owned(), VERSION.to_vec()),
            ]
        );
    }

    #[test]
    fn dos_timestamp_fields_are_zeroed() {
        let normalized = normalize_gp(&zip_with(
            &[("Content/score.gpif", SCORE)],
            DateTime::from_date_and_time(2026, 3, 2, 9, 30, 0).unwrap(),
            CompressionMethod::Deflated,
        ));

        // Local header: time @ +10, date @ +12.
        assert_eq!(read_u16(&normalized, 10), 0);
        assert_eq!(read_u16(&normalized, 12), 0);

        let eocd = find_eocd(&normalized).unwrap();
        let central = read_u32(&normalized, eocd + 16) as usize;
        assert_eq!(read_u16(&normalized, central + 12), 0);
        assert_eq!(read_u16(&normalized, central + 14), 0);
    }

    #[test]
    fn non_zip_input_passes_through_untouched() {
        // A legacy binary .gp5 starts with a pascal-string version block.
        let legacy = b"\x18FICHIER GUITAR PRO v5.10\x00\x00".to_vec();
        assert_eq!(normalize_gp(&legacy), legacy);
        assert_eq!(normalize_gp(&[]), Vec::<u8>::new());
    }

    #[test]
    fn the_gpt_core_fixture_round_trips() {
        let fixture = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/gpt-core/src/__fixtures__/sample.gp"
        ))
        .expect("gpt-core sample fixture");

        let normalized = normalize_gp(&fixture);

        assert_eq!(normalized, normalize_gp(&normalized), "idempotent");
        assert_eq!(
            entries_of(&normalized),
            {
                let mut original = entries_of(&fixture);
                original.sort_by(|(a, _), (b, _)| a.cmp(b));
                original
            },
            "every entry payload survives byte for byte"
        );
    }
}
