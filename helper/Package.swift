// swift-tools-version: 5.9
import PackageDescription

// Nul eksterne afhaengigheder. Det er et produktvalg, ikke dovenskab:
// hjaelperen faar Tilgaengeligheds- og Skaermoptagelses-rettigheder paa brugerens
// maskine. Hver tredjepartspakke i den binaer er en pakke mere, brugeren skal
// stole paa for at turde give den de rettigheder.
let package = Package(
    name: "cmcp-helper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "cmcp-helper",
            path: "Sources/cmcp-helper"
        )
    ]
)
