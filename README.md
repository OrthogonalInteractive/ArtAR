# ArtAR

額装アートを実寸で壁に飾るWebARデモ。Vue 3 + Vite + Three.js、AndroidはWebXR / ARCore、iOSは8th Wallで構成し、GitHub Pagesに静的配置できます。

`../portfolio/` の `src/xr/main.js`、`marker.js`、`support.js`、`xr/index.html` を参照しています。Vue・Three.jsのバージョン、`window.THREE` 経由のXR8連携、8th Wall配布エンジン、Absolute Scale方式を引き継ぎました。名刺の画像認識・ハンドトラッキング・Firebaseは、この用途に必要ないため組み込んでいません。

## 起動

Node.js 20.19以上または22.12以上。

```bash
npm ci
npm run dev
npm test
npm run build
npm run preview
```

PCではカメラを使わず、3Dの部屋で試せます。スマートフォンのARには **HTTPS** が必要です。開発機の `http://192.168...` はカメラの安全な接続になりません。HTTPSのプレビュー環境かGitHub Pagesを使ってください。

## 実装した機能

- オリジナルのデモアート6点、作品選択、フレームの切り替え。
- 作品寸法・マット幅・額縁幅・厚みを含めた3Dモデル。単位はメートル。
- 部屋プレビュー、壁色・視点・ガイド変更、プレビューPNG保存。
- 壁をタップして配置、作品をドラッグして移動、ボタンまたは矢印キーで1cmずつ移動。
- AndroidはWebXRの `immersive-ar`、iOS / iPadOSは既存の8th Wallで空間追跡。Androidでは8th Wallのスクリプトを読み込みません。
- AndroidではWebXRの面検出（対応時）、CPU Depth（対応時）、垂直面へのヒットテストを利用。iOSでは空間特徴点から壁を推定。複数回一致した壁だけを採用。
- WebXR非対応のAndroidにはChrome・ARCoreの案内を表示し、ルームプレビューを継続できます。8th Wallへの自動切替は行いません。
- WebXRのDOM Overlayで作品選択・タップ・ドラッグ・終了操作を表示。権限拒否、ブラウザからの終了、起動待ち中の中止でもプレビューへ復帰。
- 額縁の面を壁に平行、額縁の法線を壁に垂直に固定。別の認識済み壁へドラッグするとその壁に追従。
- 額装外寸で配置可能な領域を計算。認識済みの隣接壁との交差も回避。
- 作品変更時は同じ壁・位置を引き継ぎ、外寸に合わせて位置を補正。収まらない作品は変更を拒否し、元の作品を保持。
- 認識済みの壁を水色の面・輪郭・格子で常時表示。作品の四隅と「つかんで移動」の案内を表示し、ドラッグ中は壁色を強調。手動の実寸補正・配置範囲指定は撤去。
- 確定した壁は未配置でも同じARセッション内で保持。カメラ外に出ても削除せず、戻すと同じ位置に表示。一部だけ再観測しても認識済みの範囲を縮めません。
- 追跡が不安定な間は作品と壁の表示を隠し、移動を停止。タブを離れるとカメラを終了。
- 管理デモ：画像アップロード、作品・実寸の編集、作品削除、コレクション編集、ブラウザ保存、JSON入出力。
- 公開コレクションのQR・共有URL作成。`?collection=quiet-room` などでゲストに見せる作品を限定。
- ゲスト表示は公開JSONを参照し、管理デモのローカル下書きは参照しない。不明な配布IDは空の状態を表示。

## 壁認識と実寸の限界

通常のAR画面でも、確定した壁を水色で表示します。未配置時とドラッグ中は濃く、配置後は薄く表示します。表示範囲は観測した面を元にした凸包です。

### 認識デバッグ

[デバッグ有効のURL](https://orthogonalinteractive.github.io/ArtAR/?debug=1)を開いてARを開始するか、AR画面右上の「デバッグ」で切り替えます。カメラは通常どおりボタン操作で開始します。

- 水色の点：Androidでは深度を世界座標へ変換した点、または垂直面へのヒットテストの観測点。iOSでは8th Wallの空間特徴点です。壁判定対象は7m未満、最大800点。深度・特徴点には床や家具の点も含みます。
- 黄色の面：広さとばらつきの条件を満たした壁候補。複数回の一致を待っています。
- 緑の面：複数回一致した壁。紫は作品を配置している壁です。
- 赤の面：点は同一面に集まっていますが、広さ・ばらつきの条件を満たさなかった候補。
- 面に付いた矢印：壁の法線（表向き）。範囲はWebXRが返した面のポリゴン、または観測点の凸包です。実際の壁の端や窓・ドアを保証するものではありません。

診断パネルには方式（WebXR / 8th Wall）、AndroidのDepth取得状況（取得中・取得待ち・非対応・エラー）・点の由来・取得した垂直面数、および追跡状態・理由、受信点数・対象点数、壁数、最大面内点数、候補の寸法とばらつき、不採用理由、一致回数を表示します。追跡が不安定な間は3Dのデバッグ表示を隠し、保持中の壁と現在の認識を区別します。

「診断をコピー」で数値のJSONを共有できます。コピーにはカメラ映像・画像・生の点群座標を含めず、サーバーへ送信しません。WebXRの観測は200msごと、点群表示とパネルは毎秒4回、壁判定は650msごとに更新し、診断モードOFFでは追加の点群描画と診断集計を停止します。デバッグのON/OFFによって検出閾値は変わりません。

### 認識の条件

Androidでは `local`・`hit-test`・`dom-overlay` を必須、`depth-sensing`・`plane-detection` を任意としてWebXRセッションを開始します。DepthはCPU形式を要求し、各ビューの投影行列で距離画像をメートル単位の世界座標へ変換します。端末・ブラウザによってDepthや面検出は提供されないことがあります。

面検出が利用できる場合は、重力に対して垂直な面の実際の観測ポリゴンを利用します。Depthが取得できない場合も、中央と周囲への最大5本のヒットテストから、垂直面で実際に観測できた位置だけを蓄積します（4cm単位で重複除去、最大800点、15秒で失効）。壁の上下・左右を映して範囲を広げてください。単一のヒット点から架空の広い壁を作ることはありません。

iOS / iPadOSはこれまでどおり8th Wallの `enableWorldPoints: true` と `scale: 'absolute'` を利用します。iOS側にApp ClipやZapparは導入していません。

深度・ヒットテスト・空間特徴点の点群は、3点RANSAC・重力方向・残差・面の広がりで選別します。床を壁として扱わないよう、元の3点法線が水平に近い候補だけを使います。ネイティブ面も含め、650msごとに判定し、異なる3回以上の更新で一致した壁を採用します。未確定の候補だけを2.5秒で失効させ、確定済みの壁は観測が途切れても保持します。確定時の位置・向きを維持し、未配置の壁は新たな観測範囲の凸包を追加します。配置後は範囲も固定します。

一時的に端末の追跡が失われた場合は、壁・作品の表示と操作を止めてデータを保持し、追跡復帰後に再表示します。「別の壁に飾る」、AR終了、WebXRの座標系リセットでは古い壁と配置を破棄します。保持はそのARセッション内だけで、次回起動やページ再読込には引き継ぎません。

- 壁ガイドは観測された範囲です。面検出APIから得たポリゴンも含め、物理的な壁の端や飾れる範囲を確定するものではありません。
- 白一色、反射、暗所、ブレ、特徴点の少ない壁は認識できないことがあります。模様・壁の角・貼った目印を映して移動してください。
- 窓・ドア・家具の意味理解、未認識の隣接壁、実物によるオクルージョンは未実装です。水色の面が物理的に飾れる場所かは目視で確認してください。
- WebXRはメートル単位、8th WallはAbsolute Scaleを利用します。いずれも計測精度を保証しません。手動補正を行わず、登録寸法とエンジンの距離推定で表示します。ピンチによる自由拡大は実寸を崩すため用意していません。
- 補正なしの誤差は実機で未計測のため、±何cm・何%という保証値はありません。距離、壁の特徴、照明、端末によって変わります。開発時の平面判定の残差閾値は、現実の寸法精度を意味しません。
- iOS Safari / iPadOS Safari / ARCore対応Android Chromeを対象とした構成です。ブラウザのAR・カメラ・モーション権限、WebGL、HTTPS、各エンジンの端末サポートが必要です。SNSアプリ内ブラウザはSafari / Chromeで開いてください。
- **この開発環境ではスマートフォン実機のカメラ・認識精度を検証していません。全端末での動作保証ではありません。** [実機確認手順](docs/device-checklist.md)を参照してください。

## GitHub Pagesへの公開

`.github/workflows/deploy.yml` を用意しています。リポジトリ名が `ArtAR` の場合も、別の名前の場合も `base: './'` によりサブディレクトリで動きます。

1. このディレクトリをGitHubリポジトリへコミット・push。
2. GitHubの **Settings → Pages → Source → GitHub Actions** を選択。
3. `main` / `master` へのpushまたはActionsの手動実行で、テスト → ビルド → Pages公開。
4. `https://<owner>.github.io/<repository>/` をスマートフォンで開く。

アプリ内のURLはクエリで切り替えるため、SPAの404リダイレクト設定は不要です。

- リポジトリ：[OrthogonalInteractive/ArtAR](https://github.com/OrthogonalInteractive/ArtAR)
- 公開先：[ArtAR](https://orthogonalinteractive.github.io/ArtAR/)
- デプロイ履歴：[GitHub Actions](https://github.com/OrthogonalInteractive/ArtAR/actions/workflows/deploy.yml)

`origin` は上記リポジトリ、既定ブランチは `master` です。PagesはGitHub Actionsからのデプロイに設定済みです。

## 作品を編集して公開する

管理画面の「端末に保存」はlocalStorageへの保存です。アカウント認証やサーバー同期は行いません。

1. 管理画面で作品・実寸・コレクションを編集。
2. **JSON書き出し** で `catalog.json` を取得。
3. リポジトリの `public/catalog.json` をそのファイルで置き換え。
4. コミット・再デプロイするとゲストのQR先に反映。

アップロード画像は端末で最大1400pxのJPEGに変換し、JSONに埋め込みます。登録は最大50点、寸法は作品幅・高さ5〜300cm。localStorageの空き容量を超えた場合はエラーを表示します。大規模運用ではオブジェクトストレージに移行してください。

QRは公開済みJSONのコレクションだけを対象にします。ローカル下書きをQRで他端末へ送信したように見せることはありません。実際の作品ファイルとJSONは静的公開データです。URLでの作品絞り込みは**認可や機密情報の保護ではありません**。

## 構成

```text
src/App.vue                ゲスト体験・作品選択・AR操作
src/components/Admin.vue   管理デモ
src/ar/engine.js            プレビュー / AR共通の配置・操作とライフサイクル
src/ar/platform.js          Android WebXR / iOS 8th Wallの選択と対応確認
src/ar/webxr.js             WebXRセッション・DOM Overlay・終了処理
src/ar/webxr-geometry.js    深度の座標変換・垂直面とヒットテストの観測
src/ar/wall-feedback.js     認識面の色・格子・ドラッグ用の額縁ガイド
src/ar/walls.js             垂直面検出・座標変換・角と外寸の配置制約
src/ar/artwork.js           実寸の額装モデル
src/ar/room.js              参考寸法付きの3D部屋
src/data/storage.js         入力検証・保存・配布URL
public/catalog.json        公開用作品 / コレクションデータ
public/art/                デモ用SVGアート
```

壁の座標系は +Y が上、+Z が壁から室内、+X が壁に沿った右方向。絵画はXY平面に置き、厚みは+Zに出します。配置領域は凸多角形を額装矩形で縮め、隣接壁の半空間でクリップします。その領域の最近点に補正するため、角度を変えずに壁の端からはみ出しを防ぎます。

## 検証

`npm test` で、壁・床の判別、ノイズ、矩形/非矩形の範囲、角への干渉、外寸変更、寸法検証、保存失敗、ゲスト表示、QRのパス、画面の作品変更を検証します。`npm run build` で静的出力を生成します。

WebXRについては、OS分岐、メートル単位の深度変換、床の除外、深度なしの壁観測、作品切替、DOM Overlay要求、権限拒否、非同期起動中止、セッション終了、座標リセットをモックXRセッションで検証します。実機のカメラ映像やARCoreの認識精度はこの自動テストの対象外です。

ブラウザの任意WebMCP対応時には `list_artworks` / `select_artwork` を登録します。これは画面と同じ作品選択処理を呼びます。モック登録先による契約テストのみ実施し、実際のWebMCP対応ブラウザとの接続は未検証です。

## 将来のサービス化

管理者・作品登録ユーザー・ゲストの権限設計を管理画面に示しています。実アカウント、ログイン、招待、QRの失効や権限制御はまだありません。[構成とデータモデル](docs/architecture.md)を参照してください。

## 外部依存と資料

- [8th Wall XrController.configure](https://8thwall.org/docs/api/engine/xrcontroller/configure)
- [worldPoints / trackingStatus](https://8thwall.org/docs/api/engine/xrcontroller/pipelinemodule)
- [配布エンジンのライセンス](https://github.com/8thwall/engine/blob/main/LICENSE)
- [Three.js](https://threejs.org/)
- [WebXR / ARCore対応機能](https://developers.google.com/ar/develop/webxr/arcore-comparison)
- [WebXR Depth Sensing](https://www.w3.org/TR/webxr-depth-sensing-1/)
- [WebXR Plane Detection](https://immersive-web.github.io/plane-detection/)
- [WebXR DOM Overlay](https://www.w3.org/TR/webxr-dom-overlays-1/)

iOS向けの8th Wallは `@8thwall/engine-binary@1.0.0` をjsDelivrから読み込みます。エンジンは独自の配布ライセンスで提供されるバイナリです。Google Fontsを任意の書体用に読み込み、接続できない場合はシステムフォントで表示します。作品画像・QR生成に外部画像APIは使いません。アプリにカメラ画像を送信・保存する実装、解析サービス、アクセス解析はありません。
