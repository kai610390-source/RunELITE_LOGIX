import streamlit as st
from groq import Groq
from supabase import create_client
import pandas as pd

# 1. INITIAL SETUP
st.set_page_config(page_title="MilerLogix Lab", layout="wide", page_icon="🏃‍♂️")

# Connect to your Databases/AI (Keys stored in Streamlit Secrets)
s_url = st.secrets["SUPABASE_URL"]
s_key = st.secrets["SUPABASE_KEY"]
supabase = create_client(s_url, s_key)
client = Groq(api_key=st.secrets["GROQ_API_KEY"])

# 2. SIDEBAR - PANTRY & BASELINES
st.sidebar.header("📋 Athlete Profile")
weight = st.sidebar.number_input("Weight (kg)", value=70.0, step=0.1)

# Pantry Management
st.sidebar.header("📦 My Pantry")
pantry_data = supabase.table("pantry").select("item_name").execute()
pantry_list = [item['item_name'] for item in pantry_data.data]

new_item = st.sidebar.text_input("Add Food to Pantry")
if st.sidebar.button("Add Item"):
    if new_item:
        supabase.table("pantry").insert({"item_name": new_item}).execute()
        st.rerun()

st.sidebar.write("Current Stock:", ", ".join(pantry_list))

# 3. MAIN DASHBOARD - DAILY LOG
st.title("🏃‍♂️ MilerLogix: Performance Lab")
st.markdown("### Daily Bio-Metric Input")

col1, col2, col3, col4 = st.columns(4)

with col1:
    sleep_score = st.slider("Sleep Score", 0, 100, 80)
with col2:
    hrv = st.number_input("HRV (ms)", value=60)
with col3:
    gct = st.number_input("Leg Snap (GCT ms)", value=185)
with col4:
    workout_type = st.selectbox("Today's Session", ["Rest/Easy", "Intervals", "Tempo", "Race Day"])

# 4. PERFORMANCE LOGIC (The Science)
system_prompt = f"""
You are the Head Performance Dietitian for an elite Miler (1-mile/2-mile specialist).
ATHLETE BIO: {weight}kg.
CONSTRAINTS: 
- STRICTLY NO SODIUM BICARBONATE (causes nausea). 
- Use functional foods: Beet Juice, NZ Blackcurrant, Tart Cherry, Caffeine.
- ONLY use these pantry items: {", ".join(pantry_list)}.

LOGIC TRIGGERS:
- If Sleep < 65 or HRV is 10% below baseline: Increase carb target by 15% (cortisol buffer).
- If GCT > 190ms: Prioritize CNS recovery (High protein + Magnesium).
- If 'Race Day': Provide a minute-by-minute 'Countdown to Gun' fueling timeline.

GOALS:
- Optimize Oxygen efficiency (Beets/Nitrates).
- Maximize Vascular flow (Blackcurrant).
- Buffer acidity (Chronic buffering, not Bicarb).
"""

if st.button("🚀 Generate Today's Performance Plan"):
    # Build the specific user prompt
    user_data = f"""
    Today's Stats: 
    - Sleep: {sleep_score}/100
    - HRV: {hrv}ms
    - GCT: {gct}ms
    - Session: {workout_type}
    - Weight: {weight}kg
    """
    
    with st.spinner('Analyzing metabolic load...'):
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_data}
            ],
            model="llama3-70b-8192", # Free on Groq
            temperature=0.4
        )
        
        # 5. DISPLAY THE OUTPUT
        st.divider()
        st.header("📋 The Elite Plan")
        
        # Highlight specific alerts
        if sleep_score < 65:
            st.warning("⚠️ Low Recovery Detected: Carbohydrate targets increased for CNS support.")
        if gct > 192:
            st.error("⚠️ Neuromuscular Fatigue: Leg snap is slow. CNS recovery protocol active.")
            
        st.markdown(chat_completion.choices[0].message.content)

# 6. HYDRATION QUICK-CALC
st.divider()
st.subheader("💧 Hydration Baseline")
base_water = weight * 35
st.write(f"Your baseline hydration today is **{round(base_water/1000, 2)} Liters**. Adjust +500ml per hour of sweating.")