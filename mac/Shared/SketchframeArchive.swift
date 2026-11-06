import Foundation
import Compression

/// Reads and writes `.sketchframe` archives (format v2): a zip whose first
/// entry is an uncompressed `mimetype`, followed by the files a folder package
/// holds. Foundation has no public zip API, so this is a small reader and
/// writer for what Sketchframes use (stored and deflated entries, no zip64 or
/// encryption), on the Compression framework, whose `COMPRESSION_ZLIB` is raw
/// DEFLATE as zip stores it. `packages/core/src/zip.ts` is the TypeScript
/// equivalent. See docs/FORMAT.md.
nonisolated enum SketchframeArchive {
    static let mimetype = "application/vnd.sketchframe+zip"
    static let mimetypeFileName = "mimetype"

    nonisolated enum ArchiveError: LocalizedError {
        case notAnArchive
        case corrupt(String)
        case unsupported(String)

        var errorDescription: String? {
            switch self {
            case .notAnArchive: "This file isn't a Sketchframe archive."
            case .corrupt(let detail): "This Sketchframe archive is damaged (\(detail))."
            case .unsupported(let detail): "This Sketchframe archive uses a feature Sketchframe can't read (\(detail))."
            }
        }
    }

    /// Already compressed, so stored rather than deflated again.
    private static let storedExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "heic", "avif"]
    /// What a reader wants first; everything else follows, sorted.
    private static let leadingFiles = ["README.md", "design.json", "annotations.json", "preview@2x.png"]

    private static let localSignature: UInt32 = 0x0403_4b50
    private static let centralSignature: UInt32 = 0x0201_4b50
    private static let endSignature: UInt32 = 0x0605_4b50

    /// True if the data starts like a zip.
    static func isArchive(_ data: Data) -> Bool {
        data.count >= 4 && data.prefix(4).elementsEqual([0x50, 0x4b, 0x03, 0x04])
    }

    /// Every file in the archive by path, without directories, `mimetype` or
    /// macOS metadata. A zip of a folder package (`Name.sketchframe/…`, as
    /// Finder's Compress makes) reads as if the folder were the root.
    static func entries(in data: Data) throws -> [String: Data] {
        let bytes = [UInt8](data)
        guard isArchive(data) else { throw ArchiveError.notAnArchive }

        // The end record sits after a comment of up to 64 KB.
        var end = -1
        var index = bytes.count - 22
        let lowest = max(0, bytes.count - 22 - 0xffff)
        while index >= lowest {
            if uint32(bytes, index) == endSignature {
                end = index
                break
            }
            index -= 1
        }
        guard end >= 0 else { throw ArchiveError.corrupt("no central directory") }
        let count = Int(uint16(bytes, end + 10))
        var offset = Int(uint32(bytes, end + 16))
        guard count != 0xffff, offset != 0xffff_ffff else { throw ArchiveError.unsupported("zip64") }

        var files: [String: Data] = [:]
        for _ in 0..<count {
            guard offset + 46 <= bytes.count, uint32(bytes, offset) == centralSignature else {
                throw ArchiveError.corrupt("central directory")
            }
            let flags = uint16(bytes, offset + 8)
            let method = uint16(bytes, offset + 10)
            let expectedCRC = uint32(bytes, offset + 16)
            let compressedSize = Int(uint32(bytes, offset + 20))
            let size = Int(uint32(bytes, offset + 24))
            let nameLength = Int(uint16(bytes, offset + 28))
            let extraLength = Int(uint16(bytes, offset + 30))
            let commentLength = Int(uint16(bytes, offset + 32))
            let localOffset = Int(uint32(bytes, offset + 42))
            guard offset + 46 + nameLength <= bytes.count else { throw ArchiveError.corrupt("entry name") }
            let name = String(decoding: bytes[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self)
            offset += 46 + nameLength + extraLength + commentLength

            if name.hasSuffix("/") || name.hasPrefix("__MACOSX/") || name.hasSuffix(".DS_Store") || name == mimetypeFileName {
                continue
            }
            guard flags & 1 == 0 else { throw ArchiveError.unsupported("encryption") }
            guard localOffset + 30 <= bytes.count, uint32(bytes, localOffset) == localSignature else {
                throw ArchiveError.corrupt("\(name)'s header")
            }
            let start = localOffset + 30 + Int(uint16(bytes, localOffset + 26)) + Int(uint16(bytes, localOffset + 28))
            guard start + compressedSize <= bytes.count else { throw ArchiveError.corrupt("\(name) is truncated") }
            let raw = Array(bytes[start..<(start + compressedSize)])

            let contents: [UInt8]
            switch method {
            case 0: contents = raw
            case 8: contents = try inflate(raw, size: size, name: name)
            default: throw ArchiveError.unsupported("compression method \(method) for \(name)")
            }
            guard contents.count == size, crc32(contents) == expectedCRC else {
                throw ArchiveError.corrupt("\(name) fails its checksum")
            }
            files[name] = Data(contents)
        }

        if files["design.json"] == nil {
            let prefixes = Set(files.keys.compactMap { $0.split(separator: "/").first.map(String.init) })
            if prefixes.count == 1, let prefix = prefixes.first, files["\(prefix)/design.json"] != nil {
                files = Dictionary(uniqueKeysWithValues: files.map { (String($0.key.dropFirst(prefix.count + 1)), $0.value) })
            }
        }
        return files
    }

    /// An archive of `files`: `mimetype` first and stored, then README,
    /// design, annotations and preview, then the rest sorted. Images are
    /// stored and text deflated. A fixed date keeps the bytes the same for the
    /// same contents.
    static func archive(_ files: [String: Data]) -> Data {
        let rank = { (name: String) in Self.leadingFiles.firstIndex(of: name) ?? Self.leadingFiles.count }
        let names = files.keys
            .filter { $0 != mimetypeFileName }
            .sorted { rank($0) != rank($1) ? rank($0) < rank($1) : $0 < $1 }

        var output: [UInt8] = []
        var central: [UInt8] = []
        var count = 0
        func add(_ name: String, _ contents: [UInt8], store: Bool) {
            let nameBytes = Array(name.utf8)
            let crc = crc32(contents)
            var method: UInt16 = 0
            var body = contents
            if !store, let deflated = deflate(contents), deflated.count < contents.count {
                method = 8
                body = deflated
            }
            // Bit 11: the name is UTF-8.
            let flags: UInt16 = nameBytes.allSatisfy { $0 < 0x80 } ? 0 : 0x800
            // 2026-01-01 00:00 in MS-DOS format.
            let dosTime: UInt16 = 0
            let dosDate: UInt16 = (46 << 9) | (1 << 5) | 1
            let localOffset = UInt32(output.count)

            append32(&output, localSignature)
            append16(&output, 20)
            append16(&output, flags)
            append16(&output, method)
            append16(&output, dosTime)
            append16(&output, dosDate)
            append32(&output, crc)
            append32(&output, UInt32(body.count))
            append32(&output, UInt32(contents.count))
            append16(&output, UInt16(nameBytes.count))
            append16(&output, 0)
            output += nameBytes
            output += body

            append32(&central, centralSignature)
            append16(&central, 0x0314) // made by Unix, spec 2.0
            append16(&central, 20)
            append16(&central, flags)
            append16(&central, method)
            append16(&central, dosTime)
            append16(&central, dosDate)
            append32(&central, crc)
            append32(&central, UInt32(body.count))
            append32(&central, UInt32(contents.count))
            append16(&central, UInt16(nameBytes.count))
            append16(&central, 0) // extra
            append16(&central, 0) // comment
            append16(&central, 0) // disk
            append16(&central, 0) // internal attributes
            append32(&central, UInt32(0o100644) << 16) // -rw-r--r--
            append32(&central, localOffset)
            central += nameBytes
            count += 1
        }

        add(mimetypeFileName, Array(mimetype.utf8), store: true)
        for name in names {
            let ext = (name as NSString).pathExtension.lowercased()
            add(name, [UInt8](files[name] ?? Data()), store: storedExtensions.contains(ext))
        }

        let centralOffset = UInt32(output.count)
        output += central
        append32(&output, endSignature)
        append16(&output, 0)
        append16(&output, 0)
        append16(&output, UInt16(count))
        append16(&output, UInt16(count))
        append32(&output, UInt32(central.count))
        append32(&output, centralOffset)
        append16(&output, 0)
        return Data(output)
    }

    /// Reads one file from a Sketchframe on disk, whether it's an archive or a
    /// folder package.
    static func file(named name: String, inSketchframeAt url: URL) -> Data? {
        if isDirectory(url) {
            return try? Data(contentsOf: url.appending(path: name))
        }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? entries(in: data)[name]
    }

    static func isDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path(percentEncoded: false), isDirectory: &isDirectory)
            && isDirectory.boolValue
    }

    // MARK: Compression

    private static func inflate(_ input: [UInt8], size: Int, name: String) throws -> [UInt8] {
        if size == 0 { return [] }
        guard !input.isEmpty else { throw ArchiveError.corrupt("\(name) is empty") }
        var output = [UInt8](repeating: 0, count: size)
        let written = input.withUnsafeBufferPointer { source in
            output.withUnsafeMutableBufferPointer { destination in
                compression_decode_buffer(
                    destination.baseAddress!, size,
                    source.baseAddress!, input.count,
                    nil, COMPRESSION_ZLIB
                )
            }
        }
        guard written == size else { throw ArchiveError.corrupt("\(name) couldn't be decompressed") }
        return output
    }

    /// `nil` when deflating wouldn't fit in the input's size, which means it
    /// isn't worth it.
    private static func deflate(_ input: [UInt8]) -> [UInt8]? {
        if input.isEmpty { return nil }
        var output = [UInt8](repeating: 0, count: input.count)
        let written = input.withUnsafeBufferPointer { source in
            output.withUnsafeMutableBufferPointer { destination in
                compression_encode_buffer(
                    destination.baseAddress!, input.count,
                    source.baseAddress!, input.count,
                    nil, COMPRESSION_ZLIB
                )
            }
        }
        return written == 0 ? nil : Array(output.prefix(written))
    }

    // MARK: Bytes

    private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xedb8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ bytes: [UInt8]) -> UInt32 {
        var crc: UInt32 = 0xffff_ffff
        for byte in bytes { crc = crcTable[Int((crc ^ UInt32(byte)) & 0xff)] ^ (crc >> 8) }
        return crc ^ 0xffff_ffff
    }

    private static func uint16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
        guard offset + 2 <= bytes.count else { return 0 }
        return UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    private static func uint32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
        guard offset + 4 <= bytes.count else { return 0 }
        return UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8
            | UInt32(bytes[offset + 2]) << 16 | UInt32(bytes[offset + 3]) << 24
    }

    private static func append16(_ bytes: inout [UInt8], _ value: UInt16) {
        bytes += [UInt8(value & 0xff), UInt8(value >> 8)]
    }

    private static func append32(_ bytes: inout [UInt8], _ value: UInt32) {
        bytes += [UInt8(value & 0xff), UInt8((value >> 8) & 0xff), UInt8((value >> 16) & 0xff), UInt8(value >> 24)]
    }
}
