import { test, expect } from "@playwright/test";

type AudioProbe = { context: AudioContext; analyser: AnalyserNode };
type AudioWindow = Window & { displayAudioProbe?: AudioProbe };

test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--autoplay-policy=no-user-gesture-required"],
    args: ["--autoplay-policy=document-user-activation-required"],
  },
});

test("page interaction enables real display audio without finding the sound button", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    window.AudioContext = new Proxy(Native, {
      construct(Target, args) {
        const context = new Target(...args);
        const analyser = context.createAnalyser();
        // Keep the real context suspended even when automation grants sticky activation.
        void context.suspend();
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (...args: [AudioNode | AudioParam, number?, number?]) {
          const result = Reflect.apply(connect, this, args);
          if (args[0] === context.destination && this !== analyser) {
            Reflect.apply(connect, this, [analyser]);
          }
          return result;
        };
        (window as AudioWindow).displayAudioProbe = { context, analyser };
        return context;
      },
    });
  });
  await page.goto("/display?dev&sound=1&duration=8");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  const button = page.getByRole("button", { name: "♪ 音を出す" });
  await expect(button).toBeVisible();
  const colors = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(colors.foreground).not.toBe(colors.background);
  expect(await page.evaluate(() => (window as AudioWindow).displayAudioProbe?.context.state)).toBe("suspended");

  await page.locator("h1.dsp-title").click();
  await expect(button).toBeHidden();
  const outputPeak = async () => page.evaluate(() => {
    const probe = (window as AudioWindow).displayAudioProbe!;
    const samples = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(samples);
    return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
  });
  await expect.poll(outputPeak).toBeGreaterThan(0.001);

  await page.getByRole("button", { name: /▶ テスト再生/ }).click();
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", { timeout: 30000 });
  await expect.poll(outputPeak).toBeGreaterThan(0.001);
  await expect(page.locator(".dsp-sound-sources")).toContainText("play:play-bgm.mp3");

  await page.goto("/display?sound=1");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  await page.keyboard.press("Enter");
  await expect(button).toBeHidden();
  await expect.poll(outputPeak).toBeGreaterThan(0.001);

  await page.goto("/display?mute=1");
  await page.locator("h1.dsp-title").click();
  expect(await page.evaluate(() => (window as AudioWindow).displayAudioProbe)).toBeUndefined();
});
