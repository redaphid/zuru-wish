import { expect } from "chai";
import { make } from "./Wish.mjs";
import { getPixelColor, setupTestEnvironment, cleanupTestEnvironment, timeout } from "./testHelpers.mjs";

const cranesContainer = document.getElementById("wishes");

describe("Wish", () => {
  let render;
  /** @type {HTMLCanvasElement} */
  let canvas;
  beforeEach(async () => {
    ({ render, canvas } = await setupTestEnvironment());
  });
  afterEach(() => {
    cleanupTestEnvironment(render, canvas);
  });
  it("should exist", () => {
    expect(render).to.exist;
  });
  describe("When called with a red fragment shader", () => {
    beforeEach(() => {
      render({
        fragmentShader: `
          vec3 render(vec2 uv, vec3 last) {
             vec3 allRed = rgb2hsl(vec3(1.0, 0.0, 0.0));
             return allRed;
          }
        `,
      });
    });
    it("should render a red square", () => {
      const pixel = getPixelColor(canvas, 0, 0);
      expect(pixel).to.deep.equal(new Uint8Array([255, 0, 0, 255]));
    });
    describe("When later called with a green fragment shader", () => {
      let res;
      beforeEach(() => {
        res = render({
          fragmentShader: `
            vec3 render(vec2 uv, vec3 last) {
              vec3 allGreen = rgb2hsl(vec3(0.0, 1.0, 0.0));
              return allGreen;
            }
          `,
        });
      });
      it("should render a green square", () => {
        const pixel = getPixelColor(canvas, 0, 0);
        expect(pixel).to.deep.equal(new Uint8Array([0, 255, 0, 255]));
      });
    });
  });
  describe("When called with a feature", () => {
    const shader = `
      vec3 render(vec2 uv, vec3 last) {
        vec3 allBlue = rgb2hsl(vec3(0.0, 0.0, blue));
        return allBlue;
      }
    `;
    beforeEach(() => {
      render({ fragmentShader: shader, features: { blue: 0.5 } });
    });
    it("should render a blue square", () => {
      const pixel = getPixelColor(canvas, 0, 0);
      const [r, g, b, a] = pixel;
      expect(r).to.equal(0);
      expect(g).to.equal(0);
      expect(b).to.be.closeTo(128, 1);
      expect(a).to.equal(255);
    });
    describe("When called and that feature changes", () => {
      let res;

      beforeEach(() => {
        res = render({ fragmentShader: shader, features: { blue: 1.0 } });
      });
      it("should render a blue square", () => {
        const pixel = getPixelColor(canvas, 0, 0);
        const [r, g, b, a] = pixel;
        expect(r).to.equal(0);
        expect(g).to.equal(0);
        expect(b).to.equal(255);
        expect(a).to.equal(255);
      });
    });
    describe("When called without a shader the next time", () => {
      let res;
      beforeEach(() => {
        res = render({ blue: 0.25 });
      });
      it("should be fine with it", () => {
        const pixel = getPixelColor(canvas, 0, 0);
        const [r, g, b, a] = pixel;
        expect(r).to.equal(0);
        expect(g).to.equal(0);
        expect(b).to.equal(64);
        expect(a).to.equal(255);
      });
    });
    describe("When called with the same shader string as the last time but without features", () => {
      let res;
      beforeEach(() => {
        res = render(shader);
      });
      it("should be fine with it", () => {
        const pixel = getPixelColor(canvas, 0, 0);
        const [r, g, b, a] = pixel;
        expect(r).to.equal(0);
        expect(g).to.equal(0);
        expect(b).to.be.closeTo(128, 1);
        expect(a).to.equal(255);
      });
    });
    describe("When called without any arguments", () => {
      let res;
      beforeEach(() => {
        res = render();
      });
      it("should render a blue square", () => {
        const pixel = getPixelColor(canvas, 0, 0);
        const [r, g, b, a] = pixel;
        expect(r).to.equal(0);
        expect(g).to.equal(0);
        expect(b).to.be.closeTo(128, 1);
        expect(a).to.equal(255);
      });
    });
  });
  describe("When called with only a shader and it references time", () => {
    let originalPerformance;
    let performanceNow;
    beforeEach(async () => {
      originalPerformance = globalThis.performance;
      globalThis.performance = { now: () => 0 };
      render = await make({ canvas });
    });
    afterEach(() => {
      globalThis.performance = originalPerformance;
    });
    beforeEach(() => {
      render(`
          vec3 render(vec2 uv, vec3 last) {
            vec3 blueish = rgb2hsl(vec3(0.0, 0.0, sin(time)));
            return blueish;
          }
        `);
    });
    it("should increment the blue color by the time", () => {
      const [red, green, blue] = getPixelColor(canvas, 0, 0);
      expect([red, green, blue]).to.deep.equal([0, 0, 0]);
    });

    describe("When we wait 16ms and call it again", () => {
      let changed;
      beforeEach(async () => {
        globalThis.performance = { now: () => 16 }; // 16ms = 1 frame
        changed = render();
      });
      it("should render a different color", () => {
        const [red, green, blue] = getPixelColor(canvas, 0, 0);
        expect(blue).to.be.greaterThan(1);
      });
    });
  });
  describe("When called with only a shader and it references time", () => {
    beforeEach(() => {
      render(`
          vec3 render(vec2 uv, vec3 last) {
            vec3 greenish = rgb2hsl(vec3(0.0, sin(time), 0.0));
            return greenish;
          }
        `);
    });
    it("should be ok with it", () => {
      const [red, green, blue, alpha] = getPixelColor(canvas, 0, 0);
      expect(green).not.to.equal(0);
    });
  });
  describe("When called with a shader and an initial image", () => {
    beforeEach(async () => {
      const image = document.getElementById("initial-image");
      render = await make({ canvas, initialImage: image });

      render({
        fragmentShader: `
          vec3 render(vec2 uv, vec3 last) {
            vec3 color = initial(uv);
            return color;
          }
        `,
      });
    });
    it("should render the center of the image red", () => {
      const [red, green, blue] = getPixelColor(canvas, canvas.width / 2, canvas.height / 2);
      expect([red, green, blue]).to.deep.equal([255, 0, 0]);
    });
  });
  describe("When a shader inverts whatever color was in the last frame", () => {
    beforeEach(async () => {
      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
          vec3 render(vec2 uv, vec3 last) {
            last.x = 0.5 - last.x;
            return last;
          }
        `,
      });
      render();
    });
    it("should render the center of the image teal", () => {
      const [red, green, blue] = getPixelColor(canvas, canvas.width / 2, canvas.height / 2);
      expect([red, green, blue]).to.deep.equal([0, 255, 255]);
    });
    it("should render the edges of the image white", () => {
      const [red, green, blue] = getPixelColor(canvas, 0, 0);
      expect([red, green, blue]).to.deep.equal([255, 255, 255]);
    });
    describe("When render is called again", () => {
      beforeEach(() => {
        render();
      });
      it("should render the center of the image red", () => {
        const [red, green, blue] = getPixelColor(canvas, canvas.width / 2, canvas.height / 2);
        expect([red, green, blue]).to.deep.equal([255, 0, 0]);
      });
    });
  });
  describe("When a shader inverts the brightness of the last frame", () => {
    beforeEach(async () => {
      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
            vec3 render(vec2 uv, vec3 last) {
              last.z = 1. - last.z;
              return last;
            }
          `,
      });
      render();
    });
    it("should render the edges of the image black", () => {
      const [red, green, blue] = getPixelColor(canvas, 0, 0);
      expect([red, green, blue]).to.deep.equal([0, 0, 0]);
    });
    describe("When render is called again", () => {
      beforeEach(() => {
        render();
      });
      it("should render the center of the image red", () => {
        const [red, green, blue] = getPixelColor(canvas, canvas.width / 2, canvas.height / 2);
        expect([red, green, blue]).to.deep.equal([255, 0, 0]);
      });
    });
  });
  describe("When a shader inverts the saturation of the last frame", () => {
    beforeEach(async () => {
      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
              vec3 render(vec2 uv, vec3 last) {
                last.y = 1. - last.y;
                return last;
              }
            `,
      });
      render();
    });
    it("should render center of the image white", () => {
      const [red, green, blue] = getPixelColor(canvas, 0, 0);
      expect([red, green, blue]).to.deep.equal([255, 255, 255]);
    });
    describe("When render is called again", () => {
      beforeEach(() => {
        render();
      });
      it("should render the center of the image white (or black, for some reason)", () => {
        const [red, green, blue] = getPixelColor(canvas, canvas.width / 2, canvas.width / 2);
        expect([red, green, blue]).to.deep.oneOf([[255, 255, 255], [0, 0, 0]]);
      });
    });
  });
  describe("When a mainImage shader renders a solid color", () => {
    beforeEach(() => {
      render({
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            fragColor = vec4(0.0, 0.0, 1.0, 1.0);
          }
        `,
      });
    });
    it("should render blue", () => {
      const pixel = getPixelColor(canvas, 0, 0);
      expect(pixel).to.deep.equal(new Uint8Array([0, 0, 255, 255]));
    });
  });
  describe("When a mainImage shader uses iResolution and iTime", () => {
    beforeEach(() => {
      render({
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            vec2 uv = fragCoord / iResolution.xy;
            fragColor = vec4(uv.x, uv.y, 0.0, 1.0);
          }
        `,
      });
    });
    it("should render a gradient", () => {
      const topRight = getPixelColor(canvas, canvas.width - 1, 0);
      expect(topRight[0]).to.be.greaterThan(200); // high x = high red
      expect(topRight[1]).to.be.greaterThan(200); // high y = high green (WebGL flipped)
    });
  });
  describe("When a mainImage shader uses getLastFrameColor", () => {
    beforeEach(async () => {
      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            vec2 uv = fragCoord / iResolution.xy;
            fragColor = getLastFrameColor(uv);
          }
        `,
      });
      render();
    });
    it("should render the initial image (red circle in center)", () => {
      const center = getPixelColor(canvas, canvas.width / 2, canvas.height / 2);
      expect(center[0]).to.be.greaterThan(200); // red
      expect(center[1]).to.be.lessThan(50);
      expect(center[2]).to.be.lessThan(50);
    });
  });
  describe("When a mainImage shader uses getInitialFrameColor", () => {
    beforeEach(async () => {
      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            vec2 uv = fragCoord / iResolution.xy;
            fragColor = getInitialFrameColor(uv);
          }
        `,
      });
      render();
    });
    it("should render the initial image", () => {
      const center = getPixelColor(canvas, canvas.width / 2, canvas.height / 2);
      expect(center[0]).to.be.greaterThan(200); // red circle
    });
  });
  describe("When a mainImage shader uses rgb2hsl and hsl2rgb", () => {
    beforeEach(() => {
      render({
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            vec3 red = vec3(1.0, 0.0, 0.0);
            vec3 hsl = rgb2hsl(red);
            vec3 back = hsl2rgb(hsl);
            fragColor = vec4(back, 1.0);
          }
        `,
      });
    });
    it("should roundtrip red through HSL", () => {
      const pixel = getPixelColor(canvas, 0, 0);
      expect(pixel[0]).to.be.closeTo(255, 1);
      expect(pixel[1]).to.equal(0);
      expect(pixel[2]).to.equal(0);
    });
  });
  describe("When a mainImage shader uses audio feature uniforms", () => {
    beforeEach(() => {
      render({
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            fragColor = vec4(energyNormalized, bassNormalized, 0.0, 1.0);
          }
        `,
        energyNormalized: 1.0,
        bassNormalized: 0.5,
      });
    });
    it("should render using the audio uniform values", () => {
      const pixel = getPixelColor(canvas, 0, 0);
      expect(pixel[0]).to.be.closeTo(255, 1); // energyNormalized=1.0
      expect(pixel[1]).to.be.closeTo(128, 1); // bassNormalized=0.5
    });
  });
  describe("When a mainImage shader passes through an asymmetric initial image", () => {
    // Create a test image: red top-left, green bottom-right
    // This detects Y-flip and X-flip issues
    let testImage;
    beforeEach(async () => {
      const imgCanvas = document.createElement("canvas");
      imgCanvas.width = 64;
      imgCanvas.height = 64;
      const ctx = imgCanvas.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 32, 32); // top-left = red
      ctx.fillStyle = "lime";
      ctx.fillRect(32, 32, 32, 32); // bottom-right = green

      testImage = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = imgCanvas.toDataURL();
      });

      render = await make({
        canvas,
        initialImage: testImage,
        fragmentShader: `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            vec2 uv = fragCoord / iResolution.xy;
            fragColor = getInitialFrameColor(uv);
          }
        `,
      });
      render();
    });
    it("should have red in the top-left", () => {
      // Sample top-left quadrant center
      const pixel = getPixelColor(canvas, canvas.width * 0.25, canvas.height * 0.25);
      expect(pixel[0]).to.be.greaterThan(200, "red channel should be high");
      expect(pixel[1]).to.be.lessThan(50, "green channel should be low");
    });
    it("should have green in the bottom-right", () => {
      // Sample bottom-right quadrant center
      const pixel = getPixelColor(canvas, canvas.width * 0.75, canvas.height * 0.75);
      expect(pixel[1]).to.be.greaterThan(200, "green channel should be high");
      expect(pixel[0]).to.be.lessThan(50, "red channel should be low");
    });
    it("should have black in the top-right", () => {
      const pixel = getPixelColor(canvas, canvas.width * 0.75, canvas.height * 0.25);
      expect(pixel[0]).to.be.lessThan(50);
      expect(pixel[1]).to.be.lessThan(50);
      expect(pixel[2]).to.be.lessThan(50);
    });
  });
  describe("when rendering has been normal for a while", () => {
    let originalWidth;
    let originalHeight;
    let originalPerformance;
    beforeEach(async () => {
      originalPerformance = globalThis.performance;
      globalThis.performance = { now: () => 0 };

      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
                vec3 render(vec2 uv, vec3 last) {
                  return last;
                }
              `,
      });
      render();
      originalWidth = canvas.width;
      originalHeight = canvas.height;
      for (let i = 0; i < 20; i++) {
        globalThis.performance = { now: () => i * 16 };
        render();
      }
    });
    afterEach(() => {
      globalThis.performance = originalPerformance;
    });
    it("should not have dropped the resolution of the canvas", () => {
      expect(canvas.width).to.equal(originalWidth);
      expect(canvas.height).to.equal(originalHeight);
    });
  });
  describe("when rendering has been slow for a while", () => {
    let originalWidth;
    let originalHeight;
    let originalPerformance;
    let now;
    beforeEach(async () => {
      originalPerformance = globalThis.performance;
      now = 0;
      globalThis.performance = { now: () => now };

      render = await make({
        canvas,
        initialImage: document.getElementById("initial-image"),
        fragmentShader: `
            vec3 render(vec2 uv, vec3 last) {
              return last;
            }
          `,
      });
      render();
      originalWidth = canvas.width;
      originalHeight = canvas.height;
      for (let i = 0; i < 20; i++) {
        now += 100;
        render();
      }
    });
    afterEach(() => {
      globalThis.performance = originalPerformance;
    });
    it("should have dropped the resolution of the canvas", () => {
      expect(canvas.width).to.be.lessThan(originalWidth);
      expect(canvas.height).to.be.lessThan(originalHeight);

    });
    it("should have a resolution greater than 0", () => {
      expect(canvas.width).to.be.greaterThan(0);
      expect(canvas.height).to.be.greaterThan(0);
    });
    describe.skip("when rendering has for been fine for 20 frames", () => {
      let previousWidth;
      let previousHeight;
      beforeEach(() => {
        previousWidth = canvas.width;
        previousHeight = canvas.height;
        for (let i = 20; i < 30; i++) {
          now += 16;
          render();
        }
      });
      it("should not have changed the resolution of the canvas", () => {
        expect(canvas.width).to.equal(previousWidth);
        expect(canvas.height).to.equal(previousHeight);
      });
    });
  });
});
