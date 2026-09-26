import WidgetKit
import SwiftUI

@main
struct TrackifyWidgetBundle: WidgetBundle {
    var body: some Widget {
        TimerWidget()
        #if os(iOS)
        TrackifyLiveActivity()
        if #available(iOS 18.0, *) { TimerControl() }
        #endif
    }
}
