import Foundation
import TrackifyKit

/// On-disk cache of the last server data so launch shows content instantly (refreshed in the background).
struct CachedData: Codable {
    var tasks: [TrackifyTask]
    var profile: Profile?
    var groups: [TaskGroup]
    var stats: StatsResponse?
    var savedAt: Date
    /// Weak ETag of the cached `/api/tasks` body (lane server); nil on servers without ETags.
    var tasksETag: String?
}

enum DataCache {
    private static var directory: URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id)
            ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("TrackifyCache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func url(_ userId: String) -> URL {
        directory.appendingPathComponent("data-\(userId).json")
    }

    static func load(userId: String) -> CachedData? {
        guard let d = try? Data(contentsOf: url(userId)) else { return nil }
        return try? TrackifyJSON.decoder().decode(CachedData.self, from: d)
    }

    /// Written off the main actor.
    static func save(_ data: CachedData, userId: String) {
        let target = url(userId)
        Task.detached(priority: .utility) {
            if let d = try? TrackifyJSON.encoder().encode(data) { try? d.write(to: target, options: .atomic) }
        }
    }

    static func clear() {
        try? FileManager.default.removeItem(at: directory)
    }
}
