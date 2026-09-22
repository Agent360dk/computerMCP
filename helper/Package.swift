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
        ),
        // Menulinje-ikonet (22/9): viser hvilke agenter der koerer og hvad de
        // goer. Eget program, fordi et ikon skal leve LAENGE, mens hjaelperen
        // startes forfra ved hvert kald.
        .executableTarget(
            name: "cmcp-status",
            path: "Sources/cmcp-status"
        )
    ]
)
