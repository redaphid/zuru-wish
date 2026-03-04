import { expect } from "chai";
import { setupTestEnvironment, cleanupTestEnvironment, getPixelColor } from "./testHelpers.mjs";
import wrapShader from "./Shader.mjs"; // Function under test

// Note: Shader tests will now also use the render pipeline to verify output

describe("Shader wrapping functionality", () => {
  let render, canvas, currentGetPixelColor;

  beforeEach(async () => {
    // Setup common environment for shader tests
    ({ render, canvas } = await setupTestEnvironment());
    currentGetPixelColor = (x, y) => getPixelColor(canvas, x, y); // Bind canvas
  });

  afterEach(() => {
    if (render && canvas) {
      cleanupTestEnvironment(render, canvas);
    }
  });

  describe("when wrapping a shader with existing version and precision", () => {
    const shader = `#version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() {
            fragColor = vec4(1.0, 0.0, 0.0, 1.0); // Simple red output
        }`;

    it("should render correctly", () => {
      render({ fragmentShader: shader }); // Render the shader
      const pixel = currentGetPixelColor(0, 0);
      expect(pixel).to.deep.equal(new Uint8Array([255, 0, 0, 255]));
    });

    it("should preserve existing version directive in wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString.startsWith("#version 300 es")).to.be.true;
    });

    it("should preserve existing precision directive exactly once in wrapped string", () => {
      const wrappedString = wrapShader(shader);
      const lines = wrappedString.split("\n");
      const precisionLines = lines.filter((line) => line.trim() === "precision highp float;");
      expect(precisionLines.length).to.equal(1, "Precision should appear exactly once");
    });
  });

  describe("when wrapping a shader with existing main function", () => {
    const shader = `// Example with old-style main
         out vec4 fragColor;
         void main() {
             fragColor = vec4(0.0, 1.0, 0.0, 1.0); // Simple green output
         }`;

    it("should render correctly", () => {
      render({ fragmentShader: shader }); // Render the shader
      const pixel = currentGetPixelColor(0, 0);
      expect(pixel).to.deep.equal(new Uint8Array([0, 255, 0, 255]));
    });

    it("should preserve the existing main function in wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString.includes("void main()")).to.be.true;
    });

    it("should not inject mainImage into wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString.includes("void mainImage(")).to.be.false;
    });
  });

  describe("when wrapping a shader with various uniform types", () => {
    const shader = `
            vec3 render(vec2 uv, vec3 last) {
                // Use values to produce a specific color
                return vec3(floatValue, 0.0, 0.5);
            }`;
    const features = {
      floatValue: 0.5, // -> R = 128
      vecValue: [0.5, 0.5, 1.0], // -> G = 51, B = 76
    };

    it("should render correctly using provided features", () => {
      render({ fragmentShader: shader, features: features });
      const [red, green, blue] = currentGetPixelColor(0, 0);
      expect(red).to.be.closeTo(128, 1);
      expect(green).to.be.closeTo(128, 1);
      expect(blue).to.be.closeTo(128, 1);
    });

    it("should add float uniform declaration to wrapped string", () => {
      const wrappedString = wrapShader(shader, features);
      expect(wrappedString.includes("uniform float floatValue;")).to.be.true;
    });

    it("should add vec3 uniform declaration to wrapped string", () => {
      const wrappedString = wrapShader(shader, features);
      expect(wrappedString.includes("uniform vec3 vecValue;")).to.be.true;
    });

    describe("and a uniform is already defined in the shader", () => {
      const shaderWithDefinedUniform = `
                uniform float alreadyDefined; // Pre-defined
                vec3 render(vec2 uv, vec3 last) {
                    return rgb2hsl(vec3(alreadyDefined, anotherValue, 0.0));
                }`;
      const featuresWithDefined = {
        alreadyDefined: 0.25, // -> R = 64
        anotherValue: 0.75, // -> G = 191
      };

      it("should render correctly using both defined and feature uniforms", () => {
        render({ fragmentShader: shaderWithDefinedUniform, features: featuresWithDefined });
        const pixel = currentGetPixelColor(0, 0);
        // Expected: [64, 191, 0, 255] (approx)
        expect(pixel[0]).to.be.closeTo(64, 1);
        expect(pixel[1]).to.be.closeTo(191, 1);
        expect(pixel[2]).to.equal(0);
        expect(pixel[3]).to.equal(255);
      });

      it("should declare the new uniform in the wrapped string", () => {
        const wrappedString = wrapShader(shaderWithDefinedUniform, featuresWithDefined);
        expect(wrappedString.includes("uniform float anotherValue;")).to.be.true;
      });

      it("should not add a duplicate declaration for the existing uniform in the wrapped string", () => {
        const wrappedString = wrapShader(shaderWithDefinedUniform, featuresWithDefined);
        const uniformLines = wrappedString.split("\n").filter((line) => line.trim().startsWith("uniform float alreadyDefined;"));
        expect(uniformLines.length).to.equal(1, "Uniform should be declared exactly once");
      });
    });
  });

  describe("when wrapping a mainImage shader", () => {
    const shader = `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
              fragColor = vec4(0.0, 0.0, 1.0, 1.0);
          }`;

    it("should render correctly", () => {
      render({ fragmentShader: shader });
      const pixel = currentGetPixelColor(0, 0);
      expect(pixel).to.deep.equal(new Uint8Array([0, 0, 255, 255]));
    });

    it("should include a main function in the wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString).to.include("void main(");
    });

    it("should include getLastFrameColor in the wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString).to.include("getLastFrameColor");
    });

    it("should include getInitialFrameColor in the wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString).to.include("getInitialFrameColor");
    });

    it("should include iResolution compatibility", () => {
      const wrappedString = wrapShader(shader);
      // mainImage shaders expect iResolution — it should be defined
      expect(wrappedString).to.include("iResolution");
    });
  });

  describe("when wrapping a mainImage shader that uses getLastFrameColor", () => {
    const shader = `
          void mainImage(out vec4 fragColor, in vec2 fragCoord) {
              vec2 uv = fragCoord / iResolution.xy;
              vec4 prev = getLastFrameColor(uv);
              fragColor = prev;
          }`;

    it("should render correctly", () => {
      render({ fragmentShader: shader });
      // Should compile and render without errors — on first frame prevFrame is (0,0,0,0)
      const pixel = currentGetPixelColor(0, 0);
      expect(pixel).to.be.an.instanceOf(Uint8Array);
    });

    it("should include getLastFrameColor definition before its use", () => {
      const wrappedString = wrapShader(shader);
      const defPos = wrappedString.indexOf("vec4 getLastFrameColor(vec2 uv)");
      const usePos = wrappedString.indexOf("getLastFrameColor(uv)");
      expect(defPos).to.be.greaterThan(-1, "getLastFrameColor should be defined");
      expect(defPos).to.be.lessThan(usePos, "definition should come before use");
    });
  });

  describe("when wrapping a shader and checking built-in additions", () => {
    const shader = `
           vec3 render(vec2 uv, vec3 last) {
                return rgb2hsl(vec3(0.0, 1., 1.)); // Simple cyan output
            }`;

    it("should render correctly", () => {
      render({ fragmentShader: shader });
      const pixel = currentGetPixelColor(0, 0);
      expect(pixel).to.deep.equal(new Uint8Array([0, 255, 255, 255]));
    });

    it("should add built-in includes in wrapped string", () => {
      const wrappedString = wrapShader(shader);
      expect(wrappedString).to.include("initial(");
    });
  });
});
