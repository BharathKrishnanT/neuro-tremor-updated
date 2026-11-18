import * as tf from '@tensorflow/tfjs';
import { SensorData } from './serial';
import {
  analyzeTremorDifferential,
  DifferentialAnalysisResult,
} from './tremorAnalyzer';

export interface TremorFeatures {
  rms: number;
  frequency: number;
  avgForce: number;
  variance: number;
  amplitude: number;
  differential: DifferentialAnalysisResult;
}

export type SensitivityLevel = 'low' | 'normal' | 'high';

const WINDOW_SIZE = 40; // 2 seconds window
const CHANNELS = 7; // ax, ay, az, gx, gy, gz, normalized fsr

export class TremorMLService {
  private model: tf.LayersModel | null = null;
  private isModelLoaded = false;
  private isModelTrained = false;
  private isTraining = false;
  private sensitivity: SensitivityLevel = 'normal';
  private customMultiplier: number = 1.35; // Calibrated clinical baseline
  private smoothedSeverity: number = 0;

  setSensitivity(level: SensitivityLevel) {
    this.sensitivity = level;
    if (level === 'low') this.customMultiplier = 2.0; // Strongly dampened (rejects handwriting/voluntary strokes)
    else if (level === 'normal') this.customMultiplier = 1.35; // Optimized balanced clinical baseline
    else if (level === 'high') this.customMultiplier = 0.90; // Sensitive to subtle micro-oscillations
  }

  getSensitivity(): SensitivityLevel {
    return this.sensitivity;
  }

  setSensitivityMultiplier(mult: number) {
    this.customMultiplier = Math.max(0.5, Math.min(3.0, mult));
  }

  getSensitivityMultiplier(): number {
    return this.customMultiplier;
  }

  /**
   * Initialize the 7-channel 1D-CNN model (IMU 6-axis + Grip Force FSR).
   * Loads from IndexedDB if available, otherwise builds a new model.
   */
  async initModel() {
    try {
      this.model = await tf.loadLayersModel('indexeddb://tremor-cnn-model-v3');
      this.isModelLoaded = true;
      this.isModelTrained = true;

      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy'],
      });
      return true;
    } catch {
      this.model = this.buildCNN();
      this.isModelLoaded = true;
      this.isModelTrained = false;
      return true;
    }
  }

  private buildCNN(): tf.LayersModel {
    const model = tf.sequential();

    model.add(
      tf.layers.conv1d({
        filters: 24,
        kernelSize: 3,
        activation: 'relu',
        inputShape: [WINDOW_SIZE, CHANNELS],
      })
    );
    model.add(tf.layers.maxPooling1d({ poolSize: 2 }));

    model.add(
      tf.layers.conv1d({
        filters: 48,
        kernelSize: 3,
        activation: 'relu',
      })
    );
    model.add(tf.layers.maxPooling1d({ poolSize: 2 }));

    model.add(tf.layers.flatten());
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.35 }));
    // 4 severity classes: Normal (0), Mild (1), Moderate (2), Severe (3)
    model.add(tf.layers.dense({ units: 4, activation: 'softmax' }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'sparseCategoricalCrossentropy',
      metrics: ['accuracy'],
    });

    return model;
  }

  /**
   * Extract spectral, rotational, and grip-pressure differential features from a window of sensor data.
   */
  extractFeatures(
    dataWindow: SensorData[],
    deviceType: 'mobile' | 'pen' = 'pen'
  ): TremorFeatures {
    const diff = analyzeTremorDifferential(
      dataWindow,
      deviceType,
      this.customMultiplier
    );

    return {
      rms: diff.rms,
      frequency: diff.dominantFreq,
      avgForce: diff.avgForce,
      variance: Number((diff.rms * diff.rms).toFixed(4)),
      amplitude: Number((diff.rms * 1.414).toFixed(3)),
      differential: diff,
    };
  }

  private prepareTensor(dataWindow: SensorData[]): tf.Tensor3D | null {
    if (dataWindow.length < WINDOW_SIZE) return null;
    const slice = dataWindow.slice(-WINDOW_SIZE);
    const values = slice.map((d) => [
      d.ax / 10,
      d.ay / 10,
      (d.az - 9.8) / 10,
      d.gx / 100,
      d.gy / 100,
      d.gz / 100,
      (d.fsr || 0) / 1000,
    ]);
    return tf.tensor3d([values], [1, WINDOW_SIZE, CHANNELS]);
  }

  /**
   * Run inference using the loaded 7-channel CNN model blended with the spectral-grip differential analyzer.
   */
  async predictSeverity(
    dataWindow: SensorData[],
    features: TremorFeatures,
    deviceType: 'mobile' | 'pen' = 'pen'
  ): Promise<number> {
    const heuristicScore = this.heuristicPrediction(features, deviceType);

    if (this.isModelLoaded && this.isModelTrained && this.model) {
      const inputTensor = this.prepareTensor(dataWindow);
      if (inputTensor) {
        try {
          const prediction = this.model.predict(inputTensor) as tf.Tensor;
          const scoreData = await prediction.data();

          inputTensor.dispose();
          prediction.dispose();

          let expectedValue = 0;
          for (let i = 0; i < 4; i++) {
            expectedValue += i * scoreData[i];
          }
          const cnnScore = expectedValue * (4 / 3);
          return Number((0.4 * cnnScore + 0.6 * heuristicScore).toFixed(2));
        } catch (error) {
          console.error('Inference error, falling back to spectral-grip analyzer:', error);
          if (inputTensor) inputTensor.dispose();
          return heuristicScore;
        }
      }
    }
    return heuristicScore;
  }

  /**
   * Train the 7-channel CNN model on a recorded session to enable personalized edge adaptation.
   */
  async trainOnSession(sessionData: SensorData[], severityLabel: string) {
    if (!this.model || sessionData.length < WINDOW_SIZE) return;
    if (this.isTraining) return;

    this.isTraining = true;

    let labelIdx = 0;
    if (severityLabel === 'Mild') labelIdx = 1;
    if (severityLabel === 'Moderate') labelIdx = 2;
    if (severityLabel === 'Severe') labelIdx = 3;

    try {
      const inputs: number[][][] = [];
      const labels: number[] = [];

      const step = 10;
      for (let i = 0; i <= sessionData.length - WINDOW_SIZE; i += step) {
        const slice = sessionData.slice(i, i + WINDOW_SIZE);
        const values = slice.map((d) => [
          d.ax / 10,
          d.ay / 10,
          (d.az - 9.8) / 10,
          d.gx / 100,
          d.gy / 100,
          d.gz / 100,
          (d.fsr || 0) / 1000,
        ]);
        inputs.push(values);
        labels.push(labelIdx);
      }

      if (inputs.length === 0) {
        this.isTraining = false;
        return;
      }

      const xs = tf.tensor3d(inputs, [inputs.length, WINDOW_SIZE, CHANNELS]);
      const ys = tf.tensor1d(labels, 'int32');

      await this.model.fit(xs, ys, {
        epochs: 5,
        batchSize: 8,
        shuffle: true,
      });

      xs.dispose();
      ys.dispose();

      await this.model.save('indexeddb://tremor-cnn-model-v3');
      this.isModelTrained = true;
    } catch (error) {
      console.error('Error training model:', error);
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Calibrated spectral-kinematic prediction mapping features to 0-4 MDS-UPDRS severity scale.
   */
  public heuristicPrediction(
    features: TremorFeatures,
    _deviceType: 'mobile' | 'pen' = 'pen'
  ): number {
    const targetScore = features.differential?.updrsScore ?? 0;
    if (targetScore === 0) {
      this.smoothedSeverity = this.smoothedSeverity * 0.65;
      return this.smoothedSeverity < 0.2 ? 0 : Math.round(this.smoothedSeverity);
    }

    this.smoothedSeverity = 0.45 * targetScore + 0.55 * this.smoothedSeverity;
    return Math.max(0, Math.min(4, Math.round(this.smoothedSeverity)));
  }

  /**
   * Maps severity score to clinical stage (Normal, Stage 1, Stage 2, Stage 3)
   */
  public getStage(severity: number): string {
    if (severity === 0) return 'Normal';
    if (severity <= 1.5) return 'Stage 1';
    if (severity <= 2.5) return 'Stage 2';
    if (severity <= 3.5) return 'Stage 3';
    return 'Stage 4';
  }
}

export const mlService = new TremorMLService();
