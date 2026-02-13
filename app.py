import streamlit as st
from groq import Groq
from supabase import create_client

# 1. DATABASE & AI SETUP
s_url = st.secrets["SUPABASE_URL"]
s_key = st.secrets["SUPABASE_KEY"]
supabase = create_client(s_url, s_key)
client = Groq(api_key=st.secrets["GROQ_API_KEY"])

# 2. APP UI
st.set_page_config(page_title="MilerLogix Lab", layout="wide")
st.title("🏃‍♂️ MilerLogix: Elite Performance Lab")

# 3. SIDEBAR: PANTRY & PROFILE
st.sidebar.header("📊 Athlete Profile")
weight = st.sidebar.number_input("Weight (kg)", value=70.0)

st.sidebar.header("📦 My Pantry")
# Pull pantry from Supabase
pantry_data = supabase.table("pantry").select("item_name").execute()
pantry_list = [item['item_name'] for item in pantry_data.data]
st.sidebar.write(", ".join(pantry_list))
new_item = st.sidebar.text_input("Add to Pantry")
if st.sidebar.button("Add Item"):
    supabase.table("pantry").insert({"item_name": new_item}).execute()
    st.rerun()

# 4. DATA SYNC (Simulated for this version)
st.header("🔄 Garmin Readiness Sync")
col1, col2, col3 = st.columns(3)
with col1:
    sleep_score = st.number_input("Sleep Score", value=80)
with col2:
    hrv = st.number_input("HRV (ms)", value=60)
with col3:
    gct = st.number_input("Ground Contact Time (ms)", value=180)

# 5. THE AI BRAIN (MilerLogix Logic)
system_prompt = f"""
You are the Head Performance Dietitian for an elite Miler. 
Athlete constraints: NO SODIUM BICARBONATE. 
Stack: Beet Juice, NZ Blackcurrant, Tart Cherry, Caffeine.
User Pantry: {", ".join(pantry_list)}
Rules: 
- If Sleep < 65 or HRV is low, increase carbs by 15%.
- If GCT > 190ms, prioritize CNS recovery (Protein/Magnesium).
- Create a specific 'Countdown to Gun' timeline for race days.
"""

if st.button("🚀 Generate Performance Plan"):
    prompt = f"Weight: {weight}kg, Sleep: {sleep_score}, HRV: {hrv}, GCT: {gct}. Provide today's fuel/hydration plan."
    
    chat_completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        model="llama3-70b-8192",
    )
    
    st.subheader("📋 Your Elite Plan")
    st.markdown(chat_completion.choices[0].message.content)
