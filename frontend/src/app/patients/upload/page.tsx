"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import DoctorCard, {
  Avatar,
  type PublicDoctor,
} from "@/components/DoctorCard";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useState,
} from "react";

type BodyRegion =
  | "CHEST"
  | "SHOULDER"
  | "HAND_WRIST"
  | "SPINE"
  | "PELVIS_HIP"
  | "LOWER_LIMB"
  /*
    The volumetric studies. A CT or an MRI is a stack of slices rather
    than a single film, so it is uploaded as one file, read by a
    different model, and cannot be shown as a picture.
  */
  | "CHEST_CT"
  | "CHEST_CT_LUNGS"
  | "CHEST_CT_RIBS"
  | "HEAD_MRI"
  | "CHEST_CT_TUMOUR"
  | "ABDOMEN_CT_COLON"
  | "ABDOMEN_CT_LIVER_VESSELS"
  | "ABDOMEN_CT_PANCREAS"
  | "ABDOMEN_CT_LIVER"
  | "ABDOMEN_CT_KIDNEY"
  | "SPINE_CT"
  | "PELVIS_CT"
  | "LOWER_LIMB_CT"
  | "SHOULDER_CT";

/*
  NOT_ANALYZED means no AI model is installed for that region yet, so
  the image goes straight to the specialist doctor.
*/
type ResultStatus =
  | "NORMAL"
  | "ABNORMAL"
  | "UNCERTAIN"
  | "NOT_ANALYZED";

type Finding = {
  name: string;
  probability: number;
  threshold: number;
  detected: boolean;
};

type AnalysisResult = {
  success: boolean;
  fileName: string;
  contentType: string;
  width: number;
  height: number;
  bodyRegion: BodyRegion;
  result: ResultStatus;
  triageResult?: ResultStatus;
  confidence: number;
  normalProbability?: number;
  abnormalProbability?: number;
  primaryFinding?: string | null;
  possibleFindings?: Finding[];
  allFindings?: Finding[];
  priority?: string;
  detectedClinic?: string;
  needsDoctorReview: boolean;
  message: string;
  disclaimer: string;
  modelName?: string;
  modelVersion?: string;
  /*
    A model that answers normal or abnormal without naming a finding
    sends its score and the cut point it was compared against, and no
    finding list. The hand model is one: it was trained to say whether a
    hand looks injured, not which injury it is.
  */
  modelScope?: string;
  abnormalityProbability?: number;
  decisionThreshold?: number;
  detectedRegion?: string;
};

type RegionConfig = {
  label: string;
  endpoint: string;
  imagingView: string;
  clinicSlug: string;
  clinicName: string;
  clinicalNotes: string;
  /*
    A volumetric region sends a whole CT or MRI instead of a film. The
    file field of its endpoint is named "study", not "image", and the
    scope note says what the model actually read, because these models
    are trained on a cropped part of a scan rather than on all of it.
  */
  isVolume?: boolean;
  scopeNote?: string;
  /*
    The anatomy the study belongs to, which is what decides the clinic.
    It is spelled out only where the name of the option differs from it:
    "Chest CT — Lung Nodule" is a chest study, and if the AI service is
    unreachable that is still what has to be saved.
  */
  bodyRegionCode?: string;
};

/*
  8001 is the port scripts/dev.mjs starts the service on, and the one
  the README documents. This default used to be 8000, which nothing
  in this project has ever listened on, so every upload failed with
  "Failed to fetch" on any machine that had no .env.local setting it.
  A default that only works when somebody remembers to override it is
  not a default.
*/
const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ??
  "http://localhost:8001";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

/*
  A volume holds hundreds of slices, so it is allowed to be far larger
  than a single film. The AI service and the backend enforce the same
  limit, this one only spares the patient a long upload that would be
  refused at the end of it.
*/
const MAX_VOLUME_FILE_SIZE = 300 * 1024 * 1024;

const allowedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/*
  Browsers report no useful content type for a NIfTI, so volumetric
  uploads are recognised by the end of their name.
*/
const allowedVolumeExtensions = [
  ".nii.gz",
  ".nii",
  ".npy",
  /*
    What a hospital actually sends: one DICOM per slice, or the whole
    folder of them zipped. The service stacks them back into a volume.
  */
  ".dcm",
  ".zip",
];

function isVolumeFileName(fileName: string) {
  const lowered = fileName.toLowerCase();

  return allowedVolumeExtensions.some(
    (extension) => lowered.endsWith(extension),
  );
}

const REGION_CONFIG: Record<BodyRegion, RegionConfig> = {
  CHEST: {
    label: "Chest",
    endpoint: "/predict/chest/findings",
    imagingView: "Chest X-ray",
    clinicSlug: "chest",
    clinicName: "Chest Clinic",
    clinicalNotes:
      "Chest X-ray uploaded by the patient for multi-label AI analysis.",
  },
  SHOULDER: {
    label: "Shoulder",
    endpoint: "/predict/shoulder",
    imagingView: "Shoulder X-ray",
    clinicSlug: "shoulder",
    clinicName: "Shoulder Clinic",
    clinicalNotes:
      "Shoulder X-ray uploaded by the patient for preliminary AI analysis.",
  },
  /*
    Hand and wrist are one anatomical unit, so they share a single upload
    option, a single AI endpoint, and the same review queue.
  */
  HAND_WRIST: {
    label: "Hand & Wrist",
    endpoint: "/predict/hand-wrist",
    imagingView: "Hand & Wrist X-ray",
    clinicSlug: "hand-wrist",
    clinicName: "Hand & Wrist Clinic",
    clinicalNotes:
      "Hand or wrist X-ray uploaded by the patient for preliminary AI analysis.",
  },
  /*
    The regions below share one generic endpoint. Each of them reaches
    its own clinic, and each starts using AI as soon as a model for it
    is installed in the AI service.
  */
  SPINE: {
    label: "Spine",
    endpoint: "/predict/region/spine",
    imagingView: "Spine X-ray",
    clinicSlug: "spine",
    clinicName: "Spine Clinic",
    clinicalNotes:
      "Spine X-ray uploaded by the patient for doctor review.",
  },
  PELVIS_HIP: {
    label: "Pelvis & Hip",
    endpoint: "/predict/region/pelvis",
    imagingView: "Pelvis & Hip X-ray",
    clinicSlug: "pelvis",
    clinicName: "Pelvis & Hip Clinic",
    clinicalNotes:
      "Pelvis or hip X-ray uploaded by the patient for doctor review.",
  },
  LOWER_LIMB: {
    label: "Leg & Foot",
    endpoint: "/predict/region/lower-limb",
    imagingView: "Lower Limb X-ray",
    clinicSlug: "lower-limb",
    clinicName: "Leg & Foot Clinic",
    clinicalNotes:
      "Leg, ankle, or foot X-ray uploaded by the patient for doctor review.",
  },
  /*
    The volumetric studies. Each of them reaches the same clinic its
    X-ray counterpart does, so a doctor reads a CT and a film of the
    same body region in one queue.

    The four at the end have no trained model yet. They are offered all
    the same: the study is saved and sent to the specialist, which is
    better for the patient than being told the upload is impossible.
  */
  CHEST_CT_LUNGS: {
    label: "Chest CT (whole scan) - Lung Involvement",
    endpoint: "/predict/volume/chest-ct-lungs",
    bodyRegionCode: "CHEST",
    imagingView: "Chest CT",
    clinicSlug: "chest",
    clinicName: "Chest Clinic",
    clinicalNotes:
      "Chest CT uploaded by the patient for preliminary AI analysis of lung involvement.",
    isVolume: true,
    scopeNote:
      "This is the only model here that reads a whole scan as it comes from the scanner. It was trained on COVID era chest CT, so it reports how much of the lung is involved rather than naming the cause.",
  },
  CHEST_CT: {
    label: "Chest CT — Lung Nodule",
    endpoint: "/predict/volume/chest-ct",
    bodyRegionCode: "CHEST",
    imagingView: "Chest CT",
    clinicSlug: "chest",
    clinicName: "Chest Clinic",
    clinicalNotes:
      "Chest CT uploaded by the patient for preliminary AI analysis of a lung nodule.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cropped around a single lung nodule. It does not search a whole chest scan for nodules.",
  },
  CHEST_CT_RIBS: {
    label: "Rib CT — Fracture Type",
    endpoint: "/predict/volume/chest-ct-ribs",
    bodyRegionCode: "CHEST",
    imagingView: "Rib CT",
    clinicSlug: "chest",
    clinicName: "Chest Clinic",
    clinicalNotes:
      "Rib CT uploaded by the patient for preliminary AI analysis of a known fracture.",
    isVolume: true,
    scopeNote:
      "This model sorts which kind a known rib fracture is. It cannot tell an intact rib from a broken one.",
  },
  HEAD_MRI: {
    label: "Head MRI — Brain Tumour",
    endpoint: "/predict/volume/head-mri",
    bodyRegionCode: "HEAD",
    imagingView: "Head MRI",
    clinicSlug: "head",
    clinicName: "Head & Skull Clinic",
    clinicalNotes:
      "Brain MRI uploaded by the patient for preliminary AI analysis of a known tumour.",
    isVolume: true,
    scopeNote:
      "This model reads a post contrast brain MRI of a known tumour and answers whether the tumour enhances. It cannot tell a brain with a tumour from one without.",
  },
  CHEST_CT_TUMOUR: {
    label: "Lung CT — Tumour",
    endpoint: "/predict/volume/chest-ct-tumour",
    bodyRegionCode: "CHEST",
    imagingView: "Lung CT",
    clinicSlug: "chest",
    clinicName: "Chest Clinic",
    clinicalNotes:
      "Lung CT uploaded by the patient for preliminary AI analysis of a tumour.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cut around part of a lung and answers whether a tumour is inside it.",
  },
  ABDOMEN_CT_COLON: {
    label: "Colon CT — Cancer",
    endpoint: "/predict/volume/abdomen-ct-colon",
    bodyRegionCode: "ABDOMEN",
    imagingView: "Colon CT",
    clinicSlug: "general",
    clinicName: "General Clinic",
    clinicalNotes:
      "Colon CT uploaded by the patient for preliminary AI analysis of a cancer.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cut around part of the colon and answers whether a cancer is inside it.",
  },
  ABDOMEN_CT_LIVER_VESSELS: {
    label: "Liver Vessels CT — Tumour",
    endpoint: "/predict/volume/abdomen-ct-liver-vessels",
    bodyRegionCode: "ABDOMEN",
    imagingView: "Liver Vessels CT",
    clinicSlug: "general",
    clinicName: "General Clinic",
    clinicalNotes:
      "Liver vessel CT uploaded by the patient for preliminary AI analysis.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cut around the vessels of the liver and answers whether a tumour is inside it.",
  },
  ABDOMEN_CT_PANCREAS: {
    label: "Pancreas CT — Tumour",
    endpoint: "/predict/volume/abdomen-ct-pancreas",
    bodyRegionCode: "ABDOMEN",
    imagingView: "Pancreas CT",
    clinicSlug: "general",
    clinicName: "General Clinic",
    clinicalNotes:
      "Pancreas CT uploaded by the patient for preliminary AI analysis of a tumour.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cut around the pancreas and answers whether a tumour is inside it.",
  },
  ABDOMEN_CT_LIVER: {
    label: "Liver CT — Tumour",
    endpoint: "/predict/volume/abdomen-ct-liver",
    bodyRegionCode: "ABDOMEN",
    imagingView: "Liver CT",
    clinicSlug: "general",
    clinicName: "General Clinic",
    clinicalNotes:
      "Liver CT uploaded by the patient for preliminary AI analysis of a tumour.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cut around the liver and answers whether a tumour is inside it.",
  },
  ABDOMEN_CT_KIDNEY: {
    label: "Kidney CT — Tumour",
    endpoint: "/predict/volume/abdomen-ct-kidney",
    bodyRegionCode: "ABDOMEN",
    imagingView: "Kidney CT",
    clinicSlug: "general",
    clinicName: "General Clinic",
    clinicalNotes:
      "Kidney CT uploaded by the patient for preliminary AI analysis of a tumour.",
    isVolume: true,
    scopeNote:
      "This model reads a volume cut around a kidney and answers whether a tumour is inside it.",
  },
  SPINE_CT: {
    label: "Spine CT (no AI model - goes to a doctor)",
    endpoint: "/predict/volume/spine-ct",
    bodyRegionCode: "SPINE",
    imagingView: "Spine CT",
    clinicSlug: "spine",
    clinicName: "Spine Clinic",
    clinicalNotes:
      "Spine CT uploaded by the patient for doctor review.",
    isVolume: true,
  },
  PELVIS_CT: {
    label: "Pelvis & Hip CT (no AI model - goes to a doctor)",
    endpoint: "/predict/volume/pelvis-ct",
    bodyRegionCode: "PELVIS_HIP",
    imagingView: "Pelvis & Hip CT",
    clinicSlug: "pelvis",
    clinicName: "Pelvis & Hip Clinic",
    clinicalNotes:
      "Pelvis or hip CT uploaded by the patient for doctor review.",
    isVolume: true,
  },
  LOWER_LIMB_CT: {
    label: "Leg & Foot CT (no AI model - goes to a doctor)",
    endpoint: "/predict/volume/lower-limb-ct",
    bodyRegionCode: "LOWER_LIMB",
    imagingView: "Lower Limb CT",
    clinicSlug: "lower-limb",
    clinicName: "Leg & Foot Clinic",
    clinicalNotes:
      "Leg, ankle, or foot CT uploaded by the patient for doctor review.",
    isVolume: true,
  },
  SHOULDER_CT: {
    label: "Shoulder CT (no AI model - goes to a doctor)",
    endpoint: "/predict/volume/shoulder-ct",
    bodyRegionCode: "SHOULDER",
    imagingView: "Shoulder CT",
    clinicSlug: "shoulder",
    clinicName: "Shoulder Clinic",
    clinicalNotes:
      "Shoulder CT uploaded by the patient for doctor review.",
    isVolume: true,
  },
};

/*
  The two groups the upload list is split into. A patient choosing
  between them is choosing what they were given at the imaging centre:
  a printed film or a disc holding a scan.
*/
const XRAY_REGIONS: BodyRegion[] = [
  "CHEST",
  "SHOULDER",
  "HAND_WRIST",
  "SPINE",
  "PELVIS_HIP",
  "LOWER_LIMB",
];

/*
  Two volumetric models the service can run are deliberately not offered
  here: the adrenal and the brain vessel ones were trained on
  segmentation masks rather than on scans, and a patient cannot produce
  a segmentation. Offering them would invite an upload that comes back
  with a confident answer about nothing. They stay reachable through the
  service for demonstration, and say so in their own scope note.
*/
const VOLUME_REGIONS: BodyRegion[] = [
  "CHEST_CT",
  "CHEST_CT_RIBS",
  "HEAD_MRI",
  "CHEST_CT_TUMOUR",
  "ABDOMEN_CT_COLON",
  "ABDOMEN_CT_LIVER_VESSELS",
  "ABDOMEN_CT_PANCREAS",
  "ABDOMEN_CT_LIVER",
  "ABDOMEN_CT_KIDNEY",
  "SPINE_CT",
  "PELVIS_CT",
  "LOWER_LIMB_CT",
  "SHOULDER_CT",
];

export default function PatientUploadPage() {
  const [bodyRegion, setBodyRegion] =
    useState<BodyRegion>("CHEST");
  /*
    The doctors of the clinic the chosen study type belongs to, and the
    one the patient picked to read it. Picking is optional: a patient
    who has no preference sends the study to the clinic, which is how
    the application worked before doctors could be chosen.
  */
  const searchParams = useSearchParams();
  const requestedDoctorId = searchParams.get("doctor");

  const [doctors, setDoctors] = useState<PublicDoctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [selectedDoctor, setSelectedDoctor] =
    useState<PublicDoctor | null>(null);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [medicalHistory, setMedicalHistory] = useState("");
  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);
  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [saveMessage, setSaveMessage] =
    useState("");

  const regionConfig = REGION_CONFIG[bodyRegion];
  const resultStatus =
    analysisResult?.triageResult ?? analysisResult?.result;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  /*
    Reads the doctors of the clinic the chosen study type belongs to.

    Several study types share one clinic, so the request is keyed on the
    clinic rather than on the option: switching between a chest X-ray
    and a chest CT is the same set of doctors and should not empty the
    list and fetch it again.

    A doctor already picked is cleared when the clinic changes. Carrying
    a chest doctor over to a spine study would address the case to
    somebody who does not read it, and the server would drop the choice
    anyway.
  */
  useEffect(() => {
    let active = true;

    setDoctorsLoading(true);
    setSelectedDoctor(null);

    fetch(`${BACKEND_URL}/api/clinics/${regionConfig.clinicSlug}/doctors`, {
      credentials: "include",
    })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;

        const listed: PublicDoctor[] = Array.isArray(data.doctors)
          ? data.doctors
          : [];

        setDoctors(listed);

        /*
          A patient who chose from the profile page arrives back here
          with the doctor named in the address. Matching it against the
          list rather than trusting it means a doctor who does not work
          in this clinic is simply not selected, which is the same
          answer the server would give.
        */
        if (requestedDoctorId) {
          const match = listed.find(
            (doctor) => doctor.id === requestedDoctorId,
          );

          if (match) setSelectedDoctor(match);
        }
      })
      .catch(() => {
        /*
          A clinic whose doctors cannot be listed does not block the
          upload. The study still reaches the clinic, which is what
          happened before any of this existed.
        */
        if (active) setDoctors([]);
      })
      .finally(() => {
        if (active) setDoctorsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [regionConfig.clinicSlug, requestedDoctorId]);

  function resetImageAndResult() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl(null);
    setAnalysisResult(null);
    setErrorMessage("");
    setSaveMessage("");
  }

  function handleRegionChange(
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    resetImageAndResult();
    setBodyRegion(event.target.value as BodyRegion);
  }

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    setErrorMessage("");
    setSaveMessage("");
    setAnalysisResult(null);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    if (regionConfig.isVolume) {
      if (!isVolumeFileName(file.name)) {
        setErrorMessage(
          "Please choose a NIfTI volume (.nii, .nii.gz), a prepared .npy volume, or a DICOM study (.dcm or a zipped series).",
        );
        event.target.value = "";
        return;
      }

      if (file.size > MAX_VOLUME_FILE_SIZE) {
        setErrorMessage(
          "The study must be smaller than 300 MB.",
        );
        event.target.value = "";
        return;
      }

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      /*
        There is nothing to preview: a browser cannot draw a stack of
        slices, so the file itself is shown instead of a picture of it.
      */
      setSelectedFile(file);
      setPreviewUrl(null);
      return;
    }

    if (!allowedImageTypes.includes(file.type)) {
      setErrorMessage(
        "Please choose a JPG, PNG, or WEBP image.",
      );
      event.target.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage(
        "The image must be smaller than 20 MB.",
      );
      event.target.value = "";
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleAnalyze(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!age || !gender) {
      setErrorMessage(
        "Please enter your age and select your gender.",
      );
      return;
    }

    if (!selectedFile) {
      setErrorMessage(
        regionConfig.isVolume
          ? `Please choose a ${regionConfig.label} file first.`
          : `Please choose a ${regionConfig.label.toLowerCase()} X-ray image first.`,
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage("");
    setSaveMessage("");
    setAnalysisResult(null);

    try {
      const aiFormData = new FormData();

      /*
        The volumetric endpoints take their file under "study", the
        X-ray ones under "image".
      */
      aiFormData.append(
        regionConfig.isVolume ? "study" : "image",
        selectedFile,
      );

      /*
        A failed analysis must never lose the image. The preliminary AI
        result is an aid, not the purpose: if the service is unreachable
        or has no model for this region, the study is still saved as
        NOT_ANALYZED and goes to the doctor of the clinic, who reads it
        without an AI suggestion.
      */
      let result: AnalysisResult;
      let analysisFailed = false;

      try {
        const aiResponse = await fetch(
          `${AI_SERVICE_URL}${regionConfig.endpoint}`,
          {
            method: "POST",
            body: aiFormData,
          },
        );

        const aiData = await aiResponse.json();

        if (!aiResponse.ok) {
          throw new Error(aiData.detail ?? "The image analysis failed.");
        }

        result = aiData as AnalysisResult;
      } catch (analysisError) {
        console.error("The preliminary analysis failed:", analysisError);

        result = {
          success: false,
          bodyRegion:
            regionConfig.bodyRegionCode ?? bodyRegion,
          detectedClinic: regionConfig.clinicSlug,
          triageResult: "NOT_ANALYZED",
          result: "NOT_ANALYZED",
          confidence: 0,
          needsDoctorReview: true,
          priority: "Needs Review",
          message:
            "No preliminary analysis was produced for this image. A doctor of the clinic reviews it directly.",
        } as AnalysisResult;

        analysisFailed = true;
      }

      const triageResult =
        result.triageResult ?? result.result;
      const possibleFindings =
        result.possibleFindings ?? [];
      const allFindings = result.allFindings ?? [];
      const primaryFinding =
        result.primaryFinding ??
        (triageResult === "ABNORMAL"
          ? `${regionConfig.label} abnormality`
          : null);

      setAnalysisResult(result);

      const studyFormData = new FormData();
      studyFormData.append("age", age);
      studyFormData.append("gender", gender);
      studyFormData.append("symptoms", symptoms.trim());
      studyFormData.append(
        "medicalHistory",
        medicalHistory.trim(),
      );
      studyFormData.append("image", selectedFile);

      /*
        The doctor the patient picked. The server checks that this
        doctor works in the clinic the study is going to before it
        stores the choice, so an empty or stale value costs nothing.
      */
      if (selectedDoctor) {
        studyFormData.append("doctorId", selectedDoctor.id);
      }
      studyFormData.append(
        "bodyRegion",
        result.bodyRegion ??
          regionConfig.bodyRegionCode ??
          bodyRegion,
      );
      studyFormData.append(
        "imagingView",
        regionConfig.imagingView,
      );
      /*
        The AI service already classifies the case as URGENT,
        NEEDS_REVIEW, or ROUTINE, so its own priority is sent through.
      */
      studyFormData.append(
        "priority",
        result.priority ??
          (result.needsDoctorReview ? "Needs Review" : "Routine"),
      );
      studyFormData.append(
        "clinicalNotes",
        regionConfig.clinicalNotes,
      );
      /*
        The clinic is decided by the body region above. This field is
        the finer answer, which only the hand and wrist pathway has: its
        router says whether the film shows a hand, a wrist, or a hand
        together with the wrist, and the reviewing doctor should see
        which of the three the reading was made on.
      */
      studyFormData.append(
        "detectedRegion",
        result.detectedRegion ??
          result.bodyRegion ??
          regionConfig.bodyRegionCode ??
          bodyRegion,
      );
      studyFormData.append(
        "detectedClinic",
        result.detectedClinic ?? regionConfig.clinicSlug,
      );
      studyFormData.append(
        "predictedFinding",
        primaryFinding ?? triageResult,
      );
      studyFormData.append(
        "triageResult",
        triageResult,
      );
      studyFormData.append(
        "primaryFinding",
        primaryFinding ?? "",
      );
      studyFormData.append(
        "possibleFindings",
        JSON.stringify(possibleFindings),
      );
      studyFormData.append(
        "allFindings",
        JSON.stringify(allFindings),
      );

      /*
        A model that answers normal or abnormal without naming a finding
        sends its score instead of a finding list. Passing it on is what
        lets the doctor's page tell that reading apart from one where
        findings were looked for and none were found.
      */
      if (
        result.abnormalityProbability !== undefined
      ) {
        studyFormData.append(
          "abnormalityProbability",
          String(result.abnormalityProbability),
        );
      }

      if (result.decisionThreshold !== undefined) {
        studyFormData.append(
          "decisionThreshold",
          String(result.decisionThreshold),
        );
      }
      studyFormData.append(
        "aiPriority",
        result.priority ??
          (result.needsDoctorReview
            ? "NEEDS_REVIEW"
            : "ROUTINE"),
      );
      studyFormData.append(
        "confidence",
        String(result.confidence),
      );
      studyFormData.append(
        "modelName",
        result.modelName ??
          `${bodyRegion.toLowerCase()}_model.keras`,
      );
      studyFormData.append(
        "modelVersion",
        result.modelVersion ?? "2.0",
      );
      studyFormData.append(
        "aiExplanation",
        result.message,
      );

      const saveResponse = await fetch(
        `${BACKEND_URL}/api/studies`,
        {
          method: "POST",
          credentials: "include",
          body: studyFormData,
        },
      );

      const saveData = await saveResponse.json();

      if (!saveResponse.ok) {
        throw new Error(
          saveData.message ??
            saveData.detail ??
            "The study could not be saved.",
        );
      }

      setSaveMessage(
        analysisFailed
          ? `No preliminary AI result was produced for this image, so it was sent to the ${regionConfig.clinicName} for a doctor to read directly.`
          : `The study was saved successfully and sent to the ${regionConfig.clinicName}.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The operation failed.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function getResultStyles() {
    if (resultStatus === "NORMAL") {
      return {
        container:
          "border-emerald-300/30 bg-emerald-400/10",
        badge:
          "border-emerald-300/30 bg-emerald-400/20 text-emerald-200",
        icon: "✓",
      };
    }

    if (resultStatus === "ABNORMAL") {
      return {
        container:
          "border-rose-300/30 bg-rose-400/10",
        badge:
          "border-rose-300/30 bg-rose-400/20 text-rose-200",
        icon: "!",
      };
    }

    /* No AI model for this region yet: the doctor reviews it directly. */
    if (resultStatus === "NOT_ANALYZED") {
      return {
        container:
          "border-cyan-300/30 bg-cyan-400/10",
        badge:
          "border-cyan-300/30 bg-cyan-400/20 text-cyan-100",
        icon: "🩺",
      };
    }

    return {
      container:
        "border-amber-300/30 bg-amber-400/10",
      badge:
        "border-amber-300/30 bg-amber-400/20 text-amber-200",
      icon: "?",
    };
  }

  const resultStyles = getResultStyles();

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/patients/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50 hover:bg-white/[0.12]"
        >
          ← Back to Dashboard
        </Link>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            RadioCare AI
          </p>

          <h1 className="mt-3 text-3xl font-black text-white md:text-4xl">
            Imaging Analysis
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            X-ray images receive preliminary findings for their body
            region. CT and MRI volumes are read by the volumetric models
            as a whole stack of slices. All results must be reviewed by
            a doctor.
          </p>
        </section>

        <div className="mt-8 grid gap-7 lg:grid-cols-2">
          <form
            onSubmit={handleAnalyze}
            className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-2xl"
          >
            <h2 className="text-2xl font-black text-white">
              {regionConfig.isVolume
                ? "Upload CT or MRI Study"
                : "Upload X-ray"}
            </h2>

            {/*
              The formats and the size limit differ between a film and a
              volume, so the line says whichever applies to the option
              in front of the patient. A fixed line naming JPG while a
              CT is selected sends people looking for a file they will
              never find.
            */}
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {regionConfig.isVolume
                ? "Supported formats: NIfTI (.nii, .nii.gz), prepared .npy volumes, and DICOM (.dcm or a zipped series). Maximum size: 300 MB."
                : "Supported formats: JPG, PNG and WEBP. Maximum size: 20 MB."}
            </p>

            <div className="mt-6">
              <label
                htmlFor="body-region"
                className="mb-2 block text-sm font-bold text-slate-200"
              >
                Study Type
              </label>

              {/*
                The two kinds of study are kept in separate groups, so a
                patient holding a printed film and a patient holding a
                disc from a CT scanner each find their own list rather
                than one long mixture of the two.
              */}
              <select
                id="body-region"
                value={bodyRegion}
                onChange={handleRegionChange}
                disabled={isAnalyzing}
                className="w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
              >
                <optgroup label="X-ray (single image)">
                  {XRAY_REGIONS.map((region) => (
                    <option key={region} value={region}>
                      {REGION_CONFIG[region].label}
                    </option>
                  ))}
                </optgroup>

                <optgroup label="CT / MRI (3D volume)">
                  {VOLUME_REGIONS.map((region) => (
                    <option key={region} value={region}>
                      {REGION_CONFIG[region].label}
                    </option>
                  ))}
                </optgroup>
              </select>

              <p className="mt-2 text-xs leading-5 text-slate-400">
                {regionConfig.isVolume
                  ? `${regionConfig.label} studies are reviewed in the ${regionConfig.clinicName}. Upload the volume as a .nii, .nii.gz, or .npy file.`
                  : `${regionConfig.label} images are reviewed in the ${regionConfig.clinicName}.`}
              </p>

              {/*
                These models read a cropped part of a scan rather than a
                whole one. A patient who assumed the entire study had
                been searched would be trusting an answer that was never
                given, so the limit is stated before the upload, not
                only after the result.
              */}
              {regionConfig.scopeNote && (
                <p className="mt-2 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
                  {regionConfig.scopeNote}
                </p>
              )}
            </div>

            {/*
              The doctors of that clinic, so the patient chooses who
              reads their study before they upload it rather than after.
            */}
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-bold text-slate-200">
                  Choose your doctor
                </label>

                {selectedDoctor ? (
                  <button
                    type="button"
                    onClick={() => setSelectedDoctor(null)}
                    className="rounded-lg border border-white/15 px-3 py-1 text-xs font-bold text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-200"
                  >
                    Change
                  </button>
                ) : null}
              </div>

              {doctorsLoading ? (
                <p className="mt-3 text-sm text-slate-400">
                  Loading the doctors of the {regionConfig.clinicName}...
                </p>
              ) : selectedDoctor ? (
                <div className="mt-3 flex items-center gap-4 rounded-2xl border border-cyan-300/35 bg-cyan-400/10 p-4">
                  {/*
                    The same circle the card showed, drawn by the same
                    component. Repeating the initials by hand here is
                    what made a doctor with a photograph lose it the
                    moment they were chosen.
                  */}
                  <Avatar
                    initials={selectedDoctor.initials}
                    name={selectedDoctor.name}
                    photoUrl={selectedDoctor.photoUrl}
                    size="h-12 w-12 text-base"
                  />

                  <div className="min-w-0">
                    <p className="font-black text-white">
                      {selectedDoctor.name}
                    </p>
                    <p className="text-xs font-bold text-cyan-200">
                      {selectedDoctor.subspecialty ||
                        selectedDoctor.specialty}
                      {" · "}
                      {selectedDoctor.yearsOfExperience} years exp
                    </p>
                  </div>
                </div>
              ) : doctors.length === 0 ? (
                /*
                  A clinic with nobody assigned to it yet. The upload is
                  not blocked: the study is saved and waits for whoever
                  the administration puts in that clinic.
                */
                <p className="mt-3 rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-sm leading-6 text-slate-300">
                  No doctor is listed in the {regionConfig.clinicName}{" "}
                  yet. Your study will be saved and read by the clinic.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {doctors.length} doctor
                    {doctors.length === 1 ? "" : "s"} in the{" "}
                    {regionConfig.clinicName}. Pick one, or leave this
                    and the clinic will assign your study.
                  </p>

                  <div className="mt-4 grid gap-4">
                    {doctors.map((doctor) => (
                      <DoctorCard
                        key={doctor.id}
                        doctor={doctor}
                        clinicKey={regionConfig.clinicSlug}
                        onChoose={() => setSelectedDoctor(doctor)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="patient-age"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Age
                </label>

                <input
                  id="patient-age"
                  type="number"
                  min="1"
                  max="120"
                  value={age}
                  onChange={(event) =>
                    setAge(event.target.value)
                  }
                  placeholder="Enter your age"
                  required
                  className="w-full rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3.5 text-white outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>

              <div>
                <label
                  htmlFor="patient-gender"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Gender
                </label>

                <select
                  id="patient-gender"
                  value={gender}
                  onChange={(event) =>
                    setGender(event.target.value)
                  }
                  required
                  className="w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 text-white outline-none focus:border-cyan-300/60"
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </div>

            {/* What the reviewing doctor needs to know about this scan */}
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="patient-symptoms"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Current symptoms
                </label>

                <textarea
                  id="patient-symptoms"
                  rows={3}
                  value={symptoms}
                  onChange={(event) =>
                    setSymptoms(event.target.value)
                  }
                  placeholder="Pain, swelling, since when..."
                  className="w-full resize-none rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3.5 text-white outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>

              <div>
                <label
                  htmlFor="patient-history"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Medical history
                </label>

                <textarea
                  id="patient-history"
                  rows={3}
                  value={medicalHistory}
                  onChange={(event) =>
                    setMedicalHistory(event.target.value)
                  }
                  placeholder="Chronic illnesses, previous surgeries, medication..."
                  className="w-full resize-none rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3.5 text-white outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>
            </div>

            <label className="mt-6 flex min-h-72 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-cyan-300/30 bg-white/[0.05] p-5 text-center transition hover:border-cyan-300/70 hover:bg-white/[0.09]">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`Selected ${regionConfig.label.toLowerCase()} X-ray preview`}
                  className="max-h-72 w-full rounded-2xl object-contain"
                />
              ) : regionConfig.isVolume &&
                selectedFile ? (
                /*
                  A stack of slices cannot be drawn by a browser, so the
                  chosen file is confirmed by name and size instead of
                  by a picture. Showing nothing here would leave the
                  patient unsure the upload had taken.
                */
                <>
                  <span className="text-6xl">🧊</span>
                  <p className="mt-5 text-lg font-black text-white">
                    {selectedFile.name}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Volume selected — no preview is possible for a CT or
                    MRI stack
                  </p>
                </>
              ) : (
                <>
                  <span className="text-6xl">
                    {regionConfig.isVolume ? "🧊" : "🩻"}
                  </span>
                  <p className="mt-5 text-lg font-black text-white">
                    {regionConfig.isVolume
                      ? `Choose a ${regionConfig.label} volume`
                      : `Choose a ${regionConfig.label.toLowerCase()} X-ray`}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {regionConfig.isVolume
                      ? "Click here to browse for a .nii.gz, .npy, or DICOM file"
                      : "Click here to browse your files"}
                  </p>
                </>
              )}

              <input
                key={bodyRegion}
                type="file"
                name="image"
                accept={
                  regionConfig.isVolume
                    ? ".nii,.nii.gz,.npy,.dcm,.zip"
                    : "image/jpeg,image/png,image/webp"
                }
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {selectedFile && (
              <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.06] p-4">
                <p className="text-sm font-bold text-white">
                  {selectedFile.name}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}

            {errorMessage && (
              <div className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm font-semibold text-rose-200">
                {errorMessage}
              </div>
            )}

            {saveMessage && (
              <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-200">
                {saveMessage}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={!selectedFile || isAnalyzing}
                className="flex flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 px-5 py-3.5 font-black text-white shadow-[0_12px_35px_rgba(14,165,233,0.25)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAnalyzing
                  ? "Analyzing..."
                  : regionConfig.isVolume
                    ? `Analyze ${regionConfig.label}`
                    : `Analyze ${regionConfig.label} X-ray`}
              </button>

              <button
                type="button"
                onClick={resetImageAndResult}
                disabled={isAnalyzing}
                className="rounded-2xl border border-white/20 bg-white/[0.08] px-5 py-3.5 font-bold text-white transition hover:bg-white/[0.14] disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            <h2 className="text-2xl font-black text-white">
              Analysis Result
            </h2>

            {!analysisResult && !isAnalyzing && (
              <div className="mt-6 flex min-h-96 flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <span className="text-6xl">🔬</span>
                <p className="mt-5 text-lg font-black text-white">
                  No analysis yet
                </p>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                  {regionConfig.isVolume
                    ? "Choose a matching CT or MRI volume and press Analyze to view the preliminary result."
                    : "Choose a matching X-ray image and press Analyze to view the preliminary result."}
                </p>
              </div>
            )}

            {isAnalyzing && (
              <div className="mt-6 flex min-h-96 flex-col items-center justify-center rounded-3xl border border-cyan-300/20 bg-cyan-400/[0.06] p-8 text-center">
                <div className="h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
                <p className="mt-6 text-lg font-black text-white">
                  {regionConfig.isVolume
                    ? "Analyzing the volume"
                    : "Analyzing the image"}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Please wait while the AI model processes the{" "}
                  {regionConfig.isVolume
                    ? regionConfig.label
                    : `${regionConfig.label.toLowerCase()} X-ray`}
                  .
                </p>
              </div>
            )}

            {analysisResult && !isAnalyzing && (
              <div
                className={`mt-6 rounded-3xl border p-6 ${resultStyles.container}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-300">
                      AI Preliminary Result
                    </p>
                    <h3 className="mt-2 text-3xl font-black text-white">
                      {resultStatus}
                    </h3>
                  </div>

                  <span
                    className={`flex h-16 w-16 items-center justify-center rounded-full border text-3xl font-black ${resultStyles.badge}`}
                  >
                    {resultStyles.icon}
                  </span>
                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  <ResultItem
                    label="Confidence"
                    value={`${analysisResult.confidence}%`}
                  />
                  <ResultItem
                    label="Body Region"
                    value={analysisResult.bodyRegion}
                  />
                  <ResultItem
                    label="Priority"
                    value={
                      analysisResult.priority ??
                      (analysisResult.needsDoctorReview
                        ? "Needs Review"
                        : "Routine")
                    }
                  />
                  <ResultItem
                    label="Clinic"
                    value={
                      analysisResult.detectedClinic ??
                      regionConfig.clinicName
                    }
                  />
                </div>

                {/* Chest, hand/wrist, and the regional models return
                    multi-label findings, the shoulder model returns two
                    probabilities, and a region without a model has no
                    findings to show at all. */}
                {analysisResult.result === "NOT_ANALYZED" ? null : bodyRegion ===
                  "SHOULDER" ? (
                  <ShoulderProbabilities result={analysisResult} />
                ) : (
                  <MultiLabelFindingsResult result={analysisResult} />
                )}

                <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-4">
                  <p className="text-sm leading-6 text-slate-200">
                    {analysisResult.message}
                  </p>
                </div>

                {analysisResult.needsDoctorReview && (
                  <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm font-bold text-amber-200">
                    Doctor review is required for this result.
                  </div>
                )}

                <p className="mt-5 text-xs leading-5 text-slate-400">
                  {analysisResult.disclaimer}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/*
  Renders the findings of any multi-label model: chest, hand, and wrist.
*/
function MultiLabelFindingsResult({
  result,
}: {
  result: AnalysisResult;
}) {
  const detectedFindings = result.possibleFindings ?? [];
  const allFindings = result.allFindings ?? [];

  /*
    A triage-only model names no findings, so the findings section below
    would tell the patient that "no supported finding exceeded its
    threshold" about a model that has no findings to exceed one. Its
    score against the cut point is the honest thing to show instead.
  */
  if (
    allFindings.length === 0 &&
    detectedFindings.length === 0 &&
    result.abnormalityProbability !== undefined
  ) {
    return (
      <TriageScoreResult result={result} />
    );
  }

  return (
    <>
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Primary Finding
        </p>
        <p className="mt-2 text-lg font-black text-white">
          {result.primaryFinding ?? "No confirmed finding"}
        </p>
      </div>

      <div className="mt-5">
        <h4 className="text-base font-black text-white">
          Findings above their decision thresholds
        </h4>

        {detectedFindings.length > 0 ? (
          <div className="mt-3 space-y-3">
            {detectedFindings.map((finding) => (
              <FindingCard
                key={finding.name}
                finding={finding}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-300">
            No supported finding clearly exceeded its decision
            threshold. A near-threshold result may still require
            doctor review.
          </div>
        )}
      </div>

      {allFindings.length > 0 && (
        <div className="mt-6">
          <h4 className="text-base font-black text-white">
            All AI finding probabilities
          </h4>
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
            {allFindings.map((finding) => (
              <FindingCard
                key={finding.name}
                finding={finding}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/*
  Renders the result of a model that answers normal or abnormal without
  naming a finding.

  The hand model is the one that does this today. It was trained on 604
  hand radiographs labelled only as normal or abnormal, so it can say
  whether a hand looks injured but not which injury it is. Showing the
  score beside the cut point lets a patient see how near the decision
  was, which matters most for the readings that come back uncertain.
*/
function TriageScoreResult({
  result,
}: {
  result: AnalysisResult;
}) {
  const score = result.abnormalityProbability ?? 0;
  const threshold = result.decisionThreshold ?? 50;

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Abnormality score
          </p>
          <p className="text-xs text-slate-400">
            decides at {threshold.toFixed(1)}%
          </p>
        </div>

        <p className="mt-2 text-3xl font-black text-white">
          {score.toFixed(1)}%
        </p>

        {/* The bar carries the same two numbers as the text above it,
            so the distance between them is visible at a glance. */}
        <div className="relative mt-4 h-2 w-full rounded-full bg-white/10">
          <div
            className={`h-2 rounded-full ${
              score >= threshold ? "bg-amber-400" : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          />
          <div
            className="absolute top-[-4px] h-4 w-0.5 bg-white/70"
            style={{ left: `${Math.min(100, Math.max(0, threshold))}%` }}
          />
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          {score >= threshold
            ? "The score is above the cut point, so this study was read as abnormal."
            : "The score is below the cut point, so this study was read as normal."}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-300">
        This model reports whether the study looks normal or abnormal. It
        does not name a specific finding, so there is no finding list for
        this reading.
      </div>
    </div>
  );
}

function ShoulderProbabilities({
  result,
}: {
  result: AnalysisResult;
}) {
  if (
    result.normalProbability === undefined ||
    result.abnormalProbability === undefined
  ) {
    return null;
  }

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <ResultItem
        label="Normal Probability"
        value={`${result.normalProbability}%`}
      />
      <ResultItem
        label="Abnormal Probability"
        value={`${result.abnormalProbability}%`}
      />
    </div>
  );
}

function FindingCard({
  finding,
  compact = false,
}: {
  finding: Finding;
  compact?: boolean;
}) {
  const nearThreshold =
    !finding.detected &&
    finding.threshold - finding.probability <= 10;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-black text-white">
            {finding.name}
          </p>
          {!compact && (
            <p className="mt-1 text-xs text-slate-400">
              Decision threshold: {finding.threshold}%
            </p>
          )}
        </div>

        <span
          className={`rounded-full border px-3 py-1 text-xs font-black ${
            finding.detected
              ? "border-rose-300/30 bg-rose-400/15 text-rose-200"
              : nearThreshold
                ? "border-amber-300/30 bg-amber-400/15 text-amber-200"
                : "border-white/10 bg-white/[0.06] text-slate-300"
          }`}
        >
          {finding.probability}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300"
          style={{
            width: `${Math.min(
              100,
              Math.max(0, finding.probability),
            )}%`,
          }}
        />
      </div>

      <p className="mt-2 text-xs font-semibold text-slate-400">
        {finding.detected
          ? "Above threshold — possible finding"
          : nearThreshold
            ? "Near threshold — doctor review"
            : "Below threshold"}
      </p>
    </div>
  );
}

function ResultItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-2 break-words text-lg font-black text-white">
        {value}
      </p>
    </div>
  );
}