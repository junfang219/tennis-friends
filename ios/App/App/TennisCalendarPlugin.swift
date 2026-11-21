import Capacitor
import EventKit
import EventKitUI
import CoreLocation

class TennisBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        if #available(iOS 17.0, *) {
            bridge?.registerPluginInstance(TennisCalendarPlugin())
        }
    }
}

/// EventKitUI owns the save and calendar selection. Never request calendar
/// access or call eventStore.save: users explicitly approve each independent copy.
@available(iOS 17.0, *)
@objc(TennisCalendarPlugin)
public class TennisCalendarPlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "TennisCalendarPlugin"
    public let jsName = "TennisCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "presentEvent", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?
    private var editor: EKEventEditViewController?
    private var store: EKEventStore?
    private var completing = false

    @objc public func presentEvent(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("Calendar unavailable", "UNAVAILABLE"); return }
            guard self.pendingCall == nil else { call.reject("Calendar editor already open", "BUSY"); return }
            guard let title = call.getString("title"), !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let notes = call.getString("notes"), let location = call.getString("location"),
                  let timezoneID = call.getString("timezone"), let timezone = TimeZone(identifier: timezoneID),
                  let allDay = call.getBool("allDay"),
                  let startText = call.getString("start"), let endText = call.getString("end"),
                  let start = self.parseDate(startText, allDay: allDay, timezone: timezone),
                  let end = self.parseDate(endText, allDay: allDay, timezone: timezone), end > start else {
                call.reject("Invalid calendar event", "INVALID_EVENT"); return
            }
            var coordinates: CLLocation?
            if call.options["coordinates"] != nil {
                guard let point = call.getObject("coordinates"),
                      let latitude = point["latitude"] as? Double, let longitude = point["longitude"] as? Double,
                      latitude.isFinite, longitude.isFinite, (-90...90).contains(latitude), (-180...180).contains(longitude) else {
                    call.reject("Invalid location", "INVALID_EVENT"); return
                }
                coordinates = CLLocation(latitude: latitude, longitude: longitude)
            }
            guard let presenter = self.bridge?.viewController,
                  presenter.viewIfLoaded?.window != nil,
                  presenter.presentedViewController == nil,
                  !presenter.isBeingDismissed else {
                call.reject("Calendar cannot be presented right now", "UNAVAILABLE"); return
            }
            let store = EKEventStore()
            let event = EKEvent(eventStore: store)
            event.title = title
            event.notes = notes
            event.location = location
            event.timeZone = timezone
            event.isAllDay = allDay
            event.startDate = start
            event.endDate = end
            if let coordinates {
                let structured = EKStructuredLocation(title: location)
                structured.geoLocation = coordinates
                event.structuredLocation = structured
            }
            let editor = EKEventEditViewController()
            editor.eventStore = store
            editor.event = event
            editor.editViewDelegate = self
            // Closing goes through the editor's Cancel button and delegate.
            editor.isModalInPresentation = true
            self.store = store
            self.editor = editor
            self.pendingCall = call
            self.completing = false
            presenter.present(editor, animated: true) {
                if editor.presentingViewController == nil {
                    self.finish(error: true)
                }
            }
        }
    }

    private func parseDate(_ text: String, allDay: Bool, timezone: TimeZone) -> Date? {
        if allDay {
            guard text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.timeZone = timezone
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.isLenient = false
            guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
            return date
        }
        // JS sends canonical UTC ISO instants. Round-trip to reject normalized
        // invalid dates that an ISO parser might otherwise silently accept.
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
        return date
    }

    public func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        guard controller === editor, !completing else { return }
        completing = true
        controller.dismiss(animated: true) { [weak self] in
            self?.finish(status: action == .saved ? "saved" : "cancelled")
        }
    }

    private func finish(status: String = "cancelled", error: Bool = false) {
        let call = pendingCall
        pendingCall = nil
        editor?.editViewDelegate = nil
        editor = nil
        store = nil
        completing = false
        if error { call?.reject("Calendar presentation failed", "UNAVAILABLE") }
        else { call?.resolve(["status": status]) }
    }
}
