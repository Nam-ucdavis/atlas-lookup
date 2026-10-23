"""Readable names for the Destrieux (aparc.a2009s) gyral/sulcal labels.

Wording follows Table 1 of Destrieux et al. (2010) NeuroImage 53:1-15,
lightly shortened. Names start lower-case because they are always shown
after "Left"/"Right".
"""

NAMES = {
    "G_and_S_frontomargin": "fronto-marginal gyrus and sulcus",
    "G_and_S_occipital_inf": "inferior occipital gyrus (O3) and sulcus",
    "G_and_S_paracentral": "paracentral lobule and sulcus",
    "G_and_S_subcentral": "subcentral gyrus (central operculum) and sulci",
    "G_and_S_transv_frontopol": "transverse frontopolar gyri and sulci",
    "G_and_S_cingul-Ant": "anterior cingulate gyrus and sulcus (ACC)",
    "G_and_S_cingul-Mid-Ant": "middle-anterior cingulate gyrus and sulcus (aMCC)",
    "G_and_S_cingul-Mid-Post": "middle-posterior cingulate gyrus and sulcus (pMCC)",
    "G_cingul-Post-dorsal": "posterior-dorsal cingulate gyrus (dPCC)",
    "G_cingul-Post-ventral": "posterior-ventral cingulate gyrus (vPCC, isthmus)",
    "G_cuneus": "cuneus (O6)",
    "G_front_inf-Opercular": "inferior frontal gyrus, opercular part",
    "G_front_inf-Orbital": "inferior frontal gyrus, orbital part",
    "G_front_inf-Triangul": "inferior frontal gyrus, triangular part",
    "G_front_middle": "middle frontal gyrus (F2)",
    "G_front_sup": "superior frontal gyrus (F1)",
    "G_Ins_lg_and_S_cent_ins": "long insular gyrus and central sulcus of the insula",
    "G_insular_short": "short insular gyri",
    "G_occipital_middle": "middle occipital gyrus (O2)",
    "G_occipital_sup": "superior occipital gyrus (O1)",
    "G_oc-temp_lat-fusifor": "fusiform gyrus (lateral occipito-temporal gyrus)",
    "G_oc-temp_med-Lingual": "lingual gyrus",
    "G_oc-temp_med-Parahip": "parahippocampal gyrus",
    "G_orbital": "orbital gyri",
    "G_pariet_inf-Angular": "angular gyrus",
    "G_pariet_inf-Supramar": "supramarginal gyrus",
    "G_parietal_sup": "superior parietal lobule",
    "G_postcentral": "postcentral gyrus",
    "G_precentral": "precentral gyrus",
    "G_precuneus": "precuneus",
    "G_rectus": "gyrus rectus (straight gyrus)",
    "G_subcallosal": "subcallosal gyrus",
    "G_temp_sup-G_T_transv": "Heschl's gyrus (anterior transverse temporal gyrus)",
    "G_temp_sup-Lateral": "superior temporal gyrus, lateral aspect",
    "G_temp_sup-Plan_polar": "planum polare (superior temporal gyrus)",
    "G_temp_sup-Plan_tempo": "planum temporale (superior temporal gyrus)",
    "G_temporal_inf": "inferior temporal gyrus (T3)",
    "G_temporal_middle": "middle temporal gyrus (T2)",
    "Lat_Fis-ant-Horizont": "lateral sulcus, anterior horizontal ramus",
    "Lat_Fis-ant-Vertical": "lateral sulcus, anterior vertical ramus",
    "Lat_Fis-post": "lateral sulcus, posterior ramus",
    "Medial_wall": "medial wall",
    "Pole_occipital": "occipital pole",
    "Pole_temporal": "temporal pole",
    "S_calcarine": "calcarine sulcus",
    "S_central": "central sulcus",
    "S_cingul-Marginalis": "cingulate sulcus, marginal branch",
    "S_circular_insula_ant": "circular sulcus of the insula, anterior segment",
    "S_circular_insula_inf": "circular sulcus of the insula, inferior segment",
    "S_circular_insula_sup": "circular sulcus of the insula, superior segment",
    "S_collat_transv_ant": "anterior transverse collateral sulcus",
    "S_collat_transv_post": "posterior transverse collateral sulcus",
    "S_front_inf": "inferior frontal sulcus",
    "S_front_middle": "middle frontal sulcus",
    "S_front_sup": "superior frontal sulcus",
    "S_interm_prim-Jensen": "sulcus intermedius primus (of Jensen)",
    "S_intrapariet_and_P_trans": "intraparietal sulcus and transverse parietal sulci",
    "S_oc_middle_and_Lunatus": "middle occipital and lunate sulci",
    "S_oc_sup_and_transversal": "superior occipital and transverse occipital sulci",
    "S_occipital_ant": "anterior occipital sulcus",
    "S_oc-temp_lat": "lateral occipito-temporal sulcus",
    "S_oc-temp_med_and_Lingual": "collateral (medial occipito-temporal) and lingual sulci",
    "S_orbital_lateral": "lateral orbital sulcus",
    "S_orbital_med-olfact": "olfactory sulcus (medial orbital sulcus)",
    "S_orbital-H_Shaped": "H-shaped orbital sulci",
    "S_parieto_occipital": "parieto-occipital sulcus",
    "S_pericallosal": "pericallosal sulcus",
    "S_postcentral": "postcentral sulcus",
    "S_precentral-inf-part": "precentral sulcus, inferior part",
    "S_precentral-sup-part": "precentral sulcus, superior part",
    "S_suborbital": "suborbital sulcus",
    "S_subparietal": "subparietal sulcus",
    "S_temporal_inf": "inferior temporal sulcus",
    "S_temporal_sup": "superior temporal sulcus",
    "S_temporal_transverse": "transverse temporal sulcus",
}


def readable(label: str) -> str:
    """'L G_front_inf-Opercular' -> 'Left inferior frontal gyrus, opercular part'."""
    hemi, _, code = label.partition(" ")
    side = {"L": "Left", "R": "Right"}.get(hemi)
    if side is None:
        side, code = "", label
    name = NAMES.get(code, code)
    return f"{side} {name}".strip()
