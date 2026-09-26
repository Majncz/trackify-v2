// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TrackifyKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TrackifyKit", targets: ["TrackifyKit"]),
    ],
    targets: [
        .target(name: "TrackifyKit", path: "Sources/TrackifyKit"),
        .testTarget(name: "TrackifyKitTests", dependencies: ["TrackifyKit"], path: "Tests/TrackifyKitTests"),
    ]
)
