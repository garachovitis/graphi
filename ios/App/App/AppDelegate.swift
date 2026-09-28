import UIKit
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grafi native printing / PDF (kept in this file so it is already part of the target).
// PDF/print = the on-screen page sheets captured as vector PDF and scaled to the paper
// (exact margins; WebKit's print formatter would shrink the page). The print-formatter
// path remains as a fallback for the web layout view.
// ─────────────────────────────────────────────────────────────────────────────
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GrafiPrintPlugin())
    }
}

final class GrafiPageRenderer: UIPrintPageRenderer {
    var header = "", footer = "", headerAlign = "center", footerAlign = "center"
    var differentFirst = false, headerDistance: CGFloat = 35, footerDistance: CGFloat = 35
    var paper = CGRect.zero, printable = CGRect.zero, marginLeft: CGFloat = 72, marginRight: CGFloat = 72
    override var paperRect: CGRect { paper }
    override var printableRect: CGRect { printable }

    private func draw(_ template: String, align: String, page: Int, y: CGFloat, fromBottom: Bool) {
        if template.isEmpty || (differentFirst && page == 0) { return }
        let text = template
            .replacingOccurrences(of: "{page}", with: String(page + 1))
            .replacingOccurrences(of: "{pages}", with: String(numberOfPages))
        let font = UIFont(name: "Carlito", size: 10) ?? UIFont.systemFont(ofSize: 10)
        let style = NSMutableParagraphStyle()
        style.alignment = align == "left" ? .left : align == "right" ? .right : .center
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor(white: 0.33, alpha: 1), .paragraphStyle: style]
        let h = font.lineHeight
        let rect = CGRect(x: marginLeft, y: fromBottom ? paper.height - y - h : y, width: paper.width - marginLeft - marginRight, height: h)
        (text as NSString).draw(in: rect, withAttributes: attrs)
    }

    override func drawHeaderForPage(at pageIndex: Int, in headerRect: CGRect) {
        draw(header, align: headerAlign, page: pageIndex, y: headerDistance, fromBottom: false)
    }
    override func drawFooterForPage(at pageIndex: Int, in footerRect: CGRect) {
        draw(footer, align: footerAlign, page: pageIndex, y: footerDistance, fromBottom: true)
    }
}

@objc(GrafiPrintPlugin)
public class GrafiPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GrafiPrintPlugin"
    public let jsName = "GrafiPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "exportPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
    ]

    /// Page geometry in PDF points (1/72 in) from the millimetres sent by JS.
    private func paper(_ call: CAPPluginCall) -> CGSize {
        let mm: (Double) -> CGFloat = { CGFloat($0 / 25.4 * 72) }
        return CGSize(width: mm(call.getDouble("width") ?? 210), height: mm(call.getDouble("height") ?? 297))
    }

    /// Exact output: each on-screen page sheet (rects in CSS px, document coordinates) is captured
    /// as a vector PDF by WebKit and scaled onto a page of the exact paper size. Header/footer,
    /// margins and line breaks are therefore identical to the screen (and to the desktop PDF).
    private func capturePages(_ call: CAPPluginCall, _ done: @escaping ((Data, Int)?) -> Void) {
        guard let webView = bridge?.webView else { return done(nil) }
        let rects: [CGRect] = (call.getArray("rects") as? [[String: Any]] ?? []).compactMap { r in
            guard let x = r["x"] as? Double, let y = r["y"] as? Double, let w = r["w"] as? Double, let h = r["h"] as? Double, w > 0, h > 0 else { return nil }
            return CGRect(x: x, y: y, width: w, height: h)
        }
        if rects.isEmpty { return done(renderPdf(call)) }
        let size = paper(call)
        var pages: [Data] = []
        func next(_ i: Int) {
            if i == rects.count {
                let out = NSMutableData()
                var box = CGRect(origin: .zero, size: size)
                guard let consumer = CGDataConsumer(data: out as CFMutableData),
                      let ctx = CGContext(consumer: consumer, mediaBox: &box, [kCGPDFContextCreator as String: "Grafi"] as CFDictionary) else { return done(nil) }
                for d in pages {
                    guard let provider = CGDataProvider(data: d as CFData), let doc = CGPDFDocument(provider), let pg = doc.page(at: 1) else { continue }
                    let src = pg.getBoxRect(.mediaBox)
                    ctx.beginPDFPage(nil)
                    ctx.scaleBy(x: size.width / src.width, y: size.height / src.height)
                    ctx.translateBy(x: -src.minX, y: -src.minY)
                    ctx.drawPDFPage(pg)
                    ctx.endPDFPage()
                }
                ctx.closePDF()
                return done((out as Data, pages.count))
            }
            let cfg = WKPDFConfiguration()
            cfg.rect = rects[i]
            webView.createPDF(configuration: cfg) { result in
                switch result {
                case .success(let d): pages.append(d); next(i + 1)
                case .failure: done(nil)
                }
            }
        }
        next(0)
    }

    /// Fallback (web layout view): WebKit's own print pagination.
    private func renderPdf(_ call: CAPPluginCall) -> (Data, Int)? {
        guard let webView = bridge?.webView else { return nil }
        let mm: (Double) -> CGFloat = { CGFloat($0 / 25.4 * 72) }
        let size = paper(call)
        let top = mm(call.getDouble("top") ?? 25.4), right = mm(call.getDouble("right") ?? 25.4)
        let bottom = mm(call.getDouble("bottom") ?? 25.4), left = mm(call.getDouble("left") ?? 25.4)
        let r = GrafiPageRenderer()
        r.paper = CGRect(origin: .zero, size: size)
        r.printable = r.paper
        r.marginLeft = left
        r.marginRight = right
        r.header = call.getString("header") ?? ""
        r.footer = call.getString("footer") ?? ""
        r.headerAlign = call.getString("headerAlign") ?? "center"
        r.footerAlign = call.getString("footerAlign") ?? "center"
        r.differentFirst = call.getBool("differentFirstPage") ?? false
        r.headerDistance = mm(call.getDouble("headerDistance") ?? 12.5)
        r.footerDistance = mm(call.getDouble("footerDistance") ?? 12.5)
        r.headerHeight = top
        r.footerHeight = bottom
        let fmt = webView.viewPrintFormatter()
        fmt.perPageContentInsets = UIEdgeInsets(top: 0, left: left, bottom: 0, right: right)
        r.addPrintFormatter(fmt, startingAtPageAt: 0)
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, r.paper, [kCGPDFContextCreator as String: "Grafi"])
        r.prepare(forDrawingPages: NSRange(location: 0, length: r.numberOfPages))
        let bounds = UIGraphicsGetPDFContextBounds()
        for i in 0..<r.numberOfPages {
            UIGraphicsBeginPDFPage()
            r.drawPage(at: i, in: bounds)
        }
        UIGraphicsEndPDFContext()
        return (data as Data, r.numberOfPages)
    }

    @objc func exportPdf(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.capturePages(call) { res in
                guard let (data, pages) = res else { return call.reject("Η δημιουργία PDF απέτυχε") }
                call.resolve(["data": data.base64EncodedString(), "pages": pages])
            }
        }
    }

    /// Prints exactly the PDF Grafi renders (same pages as on screen) via the system print sheet.
    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.capturePages(call) { res in
                guard let (data, _) = res else { return call.reject("Η δημιουργία PDF απέτυχε") }
                let info = UIPrintInfo(dictionary: nil)
                info.outputType = .general
                info.jobName = call.getString("name") ?? "Grafi"
                let pc = UIPrintInteractionController.shared
                pc.printInfo = info
                pc.printingItem = data
                pc.present(animated: true) { _, completed, error in
                    if let e = error { call.reject(e.localizedDescription) } else { call.resolve(["completed": completed]) }
                }
            }
        }
    }
}
