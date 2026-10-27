/**
 * Test fixture: injury statements from agency_safety_cpsc_recalls_api (CPSC Recalls API, U.S. government work),
 * read 2026-10-27. Every row tagged "No" whose injury text contains a death-like word (21), the two rows tagged "No"
 * with no injury statement whose title has a death-like word (injuries is null there; "" here), plus the five
 * "Background / other product" rows whose text uses an explicit death word. 14 of the "No" rows report a death:
 * 13 in the injury statement and cpsc-api:92122 in its title.
 */
import type { CpscDeathRow } from "./cpscDeaths";

const r = (id: string, tag: string, title: string, injuries: string): CpscDeathRow => ({
  id: `cpsc-api:${id}`,
  tag,
  title,
  injuries,
  date: null,
  hazard: null,
  firm: null,
  url: null,
});

export const CPSC_NO_TAG_CANDIDATES: CpscDeathRow[] = [
  r(
    "00046",
    "No",
    "CPSC, Burger King Corporation Announce Voluntary Recall of Pokemon Ball",
    "A 13-month-old girl reportedly suffocated when one-half of a Pokemon ball covered her nose and mouth. An 18-month-old girl reportedly also had a ball-half stuck over her face, causing her distress. However, the girl's father (on the second attempt) pulled the ball-half from her face.",
  ),
  r(
    "00058",
    "No",
    "In Wake of Second Death, CPSC and Burger King Again Urge Consumers to Destroy and Discard Pokemon Balls",
    "On January 25, 2000, a 4-month-old boy in Indianapolis, Ind., reportedly suffocated when one-half of a Pokémon ball that was in his crib became stuck on his face. In December, a 13-month-old girl reportedly suffocated when one-half of a Pokémon ball covered her nose and mouth. Also in December, an 18-month-old girl nearly suffocated when a ball-half got stuck over her face. On the second attempt, the girl's father was able to pull the ball-half from her face.",
  ),
  r(
    "00093",
    "No",
    "CPSC, Kmart Corp. Announce Recall of Children's Lamps",
    "Kmart has received eight reports of the lamps short circuiting and catching fire, resulting in property damage. One of these fires resulted in more than $15,000 in damages, and another caused more than $3,000 in damages. No injuries or deaths have been reported.",
  ),
  r(
    "04209",
    "No",
    "CPSC, Halcyon Manufacturing Announce Recall of SCUBA BC Inflators",
    "Halcyon has reports of 10 incidents of BCs leaking. No injuries or deaths have been reported.",
  ),
  r(
    "06266",
    "No",
    "Playskool Voluntarily Recalls Toy Tool Benches after the Death of Two Toddlers",
    "Playskool received reports that a 19-month-old boy from Martinsburg, W.V., and a 2-year-old boy from League City, Texas, suffocated when oversized plastic toy nails sold with the tool bench toys became forcefully lodged in their throats.",
  ),
  r(
    "07315",
    "No",
    "Kolcraft Recalls Play Yards After the Death of a 10-Month-Old Child",
    "CPSC received a report of a 10-month-old boy who strangled on the changing table's restraint strap that was hanging down into Kolcraft's \"Sesame Beginnings\" Travel Play Yard where the child was located. Kolcraft has received 45 reports of children rolling to the side of the rocking cradle attachment.",
  ),
  r(
    "09050",
    "No",
    "Strangulation Death of a Child Prompts Recall of Roman Blinds; Sold Exclusively at IKEA",
    "On April 4, 2008, a 1-year-old girl in Greenwich, Conn. became entangled in the inner cord of an IKEA Roman Blind and strangled. The child was in a portable playpen that was located underneath a fully lowered roman blind. She was found partially suspended with the inner cord of the blind wrapped twice around her neck.",
  ),
  r(
    "09324",
    "No",
    "Strangulation Deaths of Children Prompt Recall to Repair of Roll-Up Blinds and Roman Shades by Lewis Hyman Inc.",
    "In November 2007, a 1-year-old boy from Norridgewock, Maine became entangled and strangled in the lift cord loop of a roll-up blind. In October 2008, a 13-month-old boy from Conway, Ark. was found with his head between the exposed inner cord and the cloth on the backside of a Roman shade. The cord was not looped around the boy's neck but rather ran from ear to ear and strangled the child.",
  ),
  r(
    "09329",
    "No",
    "Strangulation Death of a Child Prompts Recall To Repair Window Blinds By Vertical Land",
    "In May 2006, CPSC received a report of a 4-year-old girl from Pensacola, Fla., who strangled in the loop of a vertical blind cord that was not attached to the wall or floor.",
  ),
  r(
    "10134",
    "No",
    'Generation 2 Worldwide and "ChildESIGNS" Drop Side Crib Brands Recalled; Three Infant Deaths Reported',
    "In July 2007, an-eight-month-old child from Newark, Ohio suffocated when he became entrapped between the drop side and the crib mattress. In October 2003, an eight-month-old child from Richmond, Ind. suffocated when he became entrapped between the drop side and the crib mattress. In September 2002, a six-month-old from Staunton, Va. suffocated when he became entrapped between the drop side and crib mattress.",
  ),
  r(
    "10211",
    "No",
    "Simplicity Cribs Recalled by Retailers; Mattress-Support Collapse Can Cause Suffocation and Strangulation",
    "CPSC has received a report of a one-year-old child from North Attleboro, Mass. who suffocated when he became entrapped between the crib mattress and the crib frame in April 2008. CPSC is aware of 13 additional incidents involving the recalled cribs collapsing, due to the metal mattress-support frame bending or detaching, including one child entrapment that did not result in injury, and one child who suffered minor cuts to his head when his mattress collapsed and he fell out of the crib.",
  ),
  r(
    "10261",
    "No",
    "IKEA Recalls Roller Blinds, all Roman Blinds and all Roll-Up Blinds Due to Risk of Strangulation",
    "Roman Blinds: CPSC and IKEA received a new report of a 1 ½-year old boy in Lowell, Massachusetts who suffered a near strangulation in February 28, 2010. On April 4, 2008, a 1-year old girl in Greenwich, Conn. became entangled in the inner cord of an IKEA Roman blind and strangled. CPSC and IKEA also received a report of a 2-year old boy who suffered a near strangulation. The last two incidents prompted previous recalls. Roll-up Blinds and Roller Blinds: No incidents reported.",
  ),
  r(
    "10271",
    "No",
    "CPSC Announces Recall to Repair Child Craft Brand Stationary-Side Cribs with Dowel Due to Entrapment and Strangulation Hazards",
    "CPSC has received four reports of children becoming entrapped between the dowel and the crib's stationary front side. In two of those reports, the child was trapped by his/her head and was in danger of being strangled. In the other two reports, the child was trapped by his/her arm. This hazard can occur on both the front and back sides of the crib.",
  ),
  r(
    "12038",
    "No",
    "Joss Rock Climbing Cam Units Recalled by Sierra Trading Post Due to a Fall Hazard; Sold Exclusively by Sierra Trading Post",
    "One incident reported in Europe. No deaths or injuries reported in the U.S.",
  ),
  r(
    "12273",
    "No",
    "Death of Child Prompts Recall of Window Blinds by Blind Xpress",
    "In 2009, a 2-year-old girl from Commerce Township, Mich. reportedly strangled in the loop of a vertical blind cord that was not attached to the wall or floor.",
  ),
  r(
    "13105",
    "No",
    "Natart Chelsea Dressers Recalled By Gemme Juvenile To Reduce Tip-Over Hazard; Death of Toddler Reported",
    "CPSC and the Company have received a report of a two-year-old boy from Barrington, Ill. who reportedly suffocated when he climbed on or up an open lower drawer into the second dresser drawer, causing the dresser to fall and entrap him between the unit and the floor.",
  ),
  r(
    "20713",
    "No",
    "Polaris Recalls Brutus Utility Vehicles (UTVs) Due to Collision and Crash Hazard (Recall Alert)",
    "Polaris has received one report where the rear brake line ruptured while in use. No collisions, crashes, injuries or deaths have been reported.",
  ),
  r(
    "20714",
    "No",
    "Polaris Recalls Pro XD Utility Vehicles Due to Collision and Crash Hazards (Recall Alert)",
    "Polaris has received eight reports of rear brake failures. No collisions, crashes, injuries or deaths have been reported.",
  ),
  r(
    "22168",
    "No",
    "Sienhua Group Recalls WarmWave and Hunter Ceramic Tower Heaters Due to Fire and Burn Hazards",
    "The firm has received eight customer reports of fire at the plug or cord and dozens of customer reports of the plug or cord overheating. There have been no reports of injury or death and one report of minor property damage.",
  ),
  r(
    "23713",
    "No",
    "Kubota Recalls Utility Vehicles Due to Injury and Collision Hazards (Recall Alert)",
    "Kubota has received five reports of incidents worldwide of steering shaft shearing. No injuries or deaths have been reported.",
  ),
  r(
    "25393",
    "No",
    "Bestway, Intex, and Polygroup Recall Certain Above-Ground Pools 48 Inches and Taller Due to Drowning Hazard; Nine Deaths Reported; Five Million Pools Sold Since 2002",
    "CPSC believes that nine children between the ages of 22 months and 3 years old have drowned, after gaining access to the pools via the footholds. The incidents occurred in California, Texas, Florida, Michigan, Wisconsin and Missouri between 2007 and 2022. CPSC is also aware of three other incidents in 2011 and 2012 where children who gained access to the recalled pools were reported to have previously used the compression strap to gain entry to the pool.",
  ),
  r("74003", "No", "CPSC Warns Of Potentially Fatal Shock Hazard From 12-Volt Battery Charger", ""),
  r("92122", "No", "Three Children Killed By Decorator Cubes", ""),
];

export const CPSC_MISSED_IDS = [
  "00046",
  "00058",
  "06266",
  "07315",
  "09050",
  "09324",
  "09329",
  "10134",
  "10211",
  "10261",
  "12273",
  "13105",
  "25393",
  "92122",
].map((n) => `cpsc-api:${n}`);

export const CPSC_BACKGROUND: CpscDeathRow[] = [
  r(
    "00027",
    "Background / other product",
    "CPSC, Northern Bedroom's Inc. Announce Recall of Bunk Beds",
    "CPSC is not aware of any deaths associated with the beds being recalled. However, since 1990, CPSC has received reports of seven children who died from becoming entrapped between the bed and the wall in upper bunks of bunk beds without guardrails.",
  ),
  r(
    "09181",
    "Background / other product",
    "SunKids Convertible Cribs Recalled by Suntech Enterprises Due to Entrapment and Suffocation Hazards",
    "None reported with this crib. However, CPSC is aware of the death of a 5-month-old child in August 2008 involving another company's nearly identical crib that was recalled. The child became entrapped between the mattress and the mesh side and suffocated.",
  ),
  r(
    "12089",
    "Background / other product",
    "Expandable Lunch Boxes Recalled by California Innovations Due to Freezer Gel Pack Ingestion Hazard",
    "The firm has received two separate reports of a dog chewing and ingesting gel from the gel pack. One dog reportedly died from ingestion of the gel. The other was reported to have received treatment and has recovered.",
  ),
  r(
    "21179",
    "Background / other product",
    "Zen Magnets and Neoballs Magnets Recalled Due to Ingestion Hazard",
    "Zen Magnets LLC is aware of two children who ingested Zen Magnets and required surgery to remove the magnets and parts of their intestines and bowels. In addition, CPSC is aware of other reports of children and teenagers ingesting high-powered magnets and requiring surgery. A 19-month-girl died after ingesting similar high-powered magnets.",
  ),
  r(
    "99018",
    "Background / other product",
    "CPSC, Manufacturers Announce Recall of Wooden Bunk Beds",
    "CPSC is not aware of any deaths associated with the beds being recalled by these five manufacturers. However, since 1990, 39 children have died from becoming entrapped in wooden or metal bunk beds with similar spaces on the top bunk. Thirty-seven of those children were 3 years old or younger. Since 1994, more than half a million hazardous bunk beds have been recalled.",
  ),
];
