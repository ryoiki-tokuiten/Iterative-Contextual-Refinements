------------------------------------------------------
# Structured Solution Pool Repository Update:
Updated Data Structures for the Structured Solution Pool Repository:
1. Structured solution pool repo for the solution pool agent (This is what the solution pool agent for strategy 1 see):
<Strategy-1: Text>
<Last Correction>
<Last Critique>
// Notice this is a big change., now we don't provide full history of the current strategy. Just latest correction + critique.
{Pool history for strategy-1 from previous iterations. This is an important change.}
{Solution-Pool-Agent-Output-Strategy-1-Iteration-1-Output}
{Solution-Pool-Agent-Output-Strategy-1-Iteration-2-Output}
...
{last full output of the solution pool agent - 1}

// We only show past 5 solution pools btw. Not the full history of pool either. Just last 5 pools.

<Strategy-1/>
<Strategy-2: text>
{last full output of the solution pool agent -2}
<Strategy-2/>
<Strategy-3: text>
{last full output of the solution pool agent -3}
<Strategy-3/>

and so on for the strategy-3, 4 and 5.

>> Solution pool agent is called before the next correction and so we have the critique for the previous correction.
>> Notice how the solution pool agent -1 now doesn't see all the history of strategy-2, 3,4  and 5. It now just sees the latest pool of that strategy. It doesn't care about their individual latest correction and critique. This is a huge context optimization while delivering the same performance.
>> Similarly, solution pool - 2 agent doesn't get the full history of  1, 3, 4 and 5. You get the point.

## How we'd manage the context and pool structure and updates as the no of iterations grows. 
worst case context:
12k / Correction
6k / Critique
Max 20k for one Correction+Critique.
Solution Pool Agent (Not the full repo. No one receives the full repo now. Each one has a custom curated one):
All pools from all strategies including current: 15k * 5 = 75k
+ Pool Histoy in the current strategy = We only show the last 4 pools for that strategy in the history + latest pool., so that is 4*15k = 60k
+ Latest Correction + Critique of current strategy = 20k

= 75 + 60 + 20 = 155k tokens.

So starting one more iteration would let it slide above the model's context window (typical 256k).

This is the most elegant solution:
Solution pool agent doesn't really care much about the history of the current strategy tbh. Just providing it with last 5 is enough. And that's exactly what we'd keep doing.
So following is the pool structure for the solution pool agent in the 9th iteration for example:
<Strategy-1: Text>
<MemoryBank For Strategy - 1 Summarizing the past 5 iterations>
<Correction-8>
<Critique for -8>
{output of the solution pool agent - iteration 4}
{output of the solution pool agent - iteration 5}
{output of the solution pool agent - iteration 6}
{output of the solution pool agent - iteration 7}
{output of the solution pool agent - 8 (last/previous pool)}
<Strategy-1/>
<Strategy-2: text>
{last full output of the solution pool agent -2}
<Strategy-2/>

and so on for the strategy-3, 4 and 5.

This preserves the 155k in worst case.

Our application UI locks the max depth of the iterative corrections mode to 10. So this is going to be stable.

--------------------------------

2. Structured solution pool repo for the correction agent (This is what the corrector agent for strategy 1 see):
<Strategy-1: Text>
<Corresponding original execution-0>
<Corresponding solution critique-1>
<Correction-1>
<Critique for correction-1>
<Correction-2>
<Critique-2>
...
{last full output of the solution pool agent - 1}
<Strategy-1/>
<Strategy-2: text>
<Latest correction>
<Latest critique>
<Strategy-2/>

and so on for the strategy-3, 4 and 5.

Yes, this is a big decision. Corrector agent will not see the solution pools from the other strategy. It's too much noise for an agent that we expect to be focused.

## How we'd manage the context and pool structure and updates as the no of iterations grows. 
worst case context:
12k / Correction
6k / Critique
Max 20k for one Correction+Critique.

Latest Correction + Corresponding Critique From 4 Strategies = 20 * 4 = 80k
+ Solution Pool From Current = 15k
+ 5 Iterations History = 100k
(First Execution + First Critique) + History of 4 (Correction + Critique)

= 195k
So now, call the memory bank agent inside each strategy, distill the full last 5 iterations history into a memory bank.

So following is the pool structure for the correction agent in the 6th iteration for example:
<Strategy-1: Text>
<MemoryBank For Strategy - 1 Summarizing the past 5 iterations>
<Correction-5>
<Critique For Correction-5>
{last full output of the solution pool agent - 1}
<Strategy-1/>
<Strategy-2: text>
<Correction-5>
<Critique For Correction-5>
<Strategy-2/>
and so on for the strategy-3, 4 and 5.

Pool structure for the correction agent in the 10th iteration for example:
<Strategy-1: Text>
<MemoryBank For Strategy - 1 Summarizing the past 5 iterations>
<Correction-5> (again, this is very important)
<Critique For Correction-5>
<Correction-6> (again, this is very important)
<Critique For Correction-6>
<Correction-7>
<Critique For Correction-7>
<Correction-8>
<Critique For Correction-8>
<Correction-9>
<Critique For Correction-9>
{last full output of the solution pool agent - 1}
<Strategy-1/>
  and so on other strategies
  
now for the 11th iteration, the important realization is that we have the 10th correction and corresponding critique ready actually.
So now we distill the correction-critique history (5, 6, 7, 8, 9) and replace it with memory bank
and so this is what it look for the 11 iteration:
Pool structure for the solution pool agent in the 10th iteration for example:
<Strategy-1: Text>
<MemoryBank For Strategy - 1 Summarizing the past 5 iterations>
<Correction-10>
<Critique For Correction-10>
{last full output of the solution pool agent - 1}
<Strategy-1/>
  and so on other strategies

No changes for the critique agent.
--------------------------------

First of all, we are going to completely remove the red team. We let the PQF agent act like a full red team now.

Here's how it will actually work from now on:

It is important to realize that elliminating strategies or sub-strategies before we see their execution and critque is just plain "judging too quickly"., and that is exactly what red team does right now.
So we completely remove the red team agent at that brittle position.
Currently, we have PQF and it runs after first execution + corresponding critique from all strategies are ready., and it can either keep the strategy as it is or ask the main generator agent to update / evolve the strategy.
The evolved strategy is again executed then critiqued, the PQF agent again receives that and can either keep it (if all kept then done) or ask to update again. It can do this 3 times., and then we have "finalized strategies".

But this is a very poor solution / approach. Instead, this is what will happen now:
We run it after 5 iterations... at the same time when we run the memory agent. But we'll run it before the memory agent because it's possible the strategy is set to update and we also have memory bank for that strategy which is just useless now because that strategy is marked to "update".
When the PQF agent marks a given strategy as "Keep"., then we do nothing for that strategy branch. We start the memory agent in that branch...
When the PQF agent marks a given strategy as "Update"., then we completely stop that branch. We don't further generate memory bank for that branch or continue the iterative correction. Most importantnly, we also remove it and it's corresponding stuff like Correction-Critique History or the solution pool from our global solution pool repository that our other correction agent or solution pool agent receives.
But unlike previously when "Update" meant literally replacing the strategy., now it will create a brand new branch with this new updated strategy., we will wait for the execution and critique in that branch. So yeah we'll store the previous failed strategies too. Update directly means new now. But the total no of strategies that are actually being explored never changes and that's why it's called "Update".
In parallel, we were running memory banks on all strategies irrespective of future decision from the PQF agent (this is important you'd realize later) and thus we have them ready now., so the updated pool will look like:

"Same as it generally looks., except the previous strategies that have been replaced their full pool and history has been completely removed and replaced with the new strategy and their corresponding latest critique and correction."

Now the solution pool and corrector agent for this new updated strategy is exactly at the same position as other solution pool and correction agents., it's just that it doesn't have it's pool yet., which will be generated in the next step.

So, for example, if the strategy 3 was marked as "update" and we have new strategy, it's execution and critique now., this is what the correction agent of this see now:
<Strategy-1: Text>
<Correction-5>
<Critique For Correction-5>
<Strategy-1/>
<Strategy-2: text>
<Correction-5>
<Critique For Correction-5>
<Strategy-2/>
<Strategy-3: text>
<Latest Execution>
<Latest Critique>
<Strategy-3/>

and so on for the strategy-4, 5 and 6.


and just to remind you, this is what the pool for the strategy-1 correction agent would look like:
<Strategy-1: Text>
<MemoryBank For Strategy - 1 Summarizing the past 5 iterations> (notice this)
<Correction-5>
<Critique For Correction-5>
{last full output of the solution pool agent - 1}
<Strategy-1/>
<Strategy-2: text>
<Correction-5>
<Critique For Correction-5>
<Strategy-2/>
<Strategy-3: text>
<Latest Execution>
<Latest Critique>
<Strategy-3/>
and so on for the strategy-4 and 5.


What about the solution pool agent (this is what the Strategy 3, the one which eas just updated will see):
<Strategy-1: Text>
<Correction-5>
<Critique for -5>
{output of the solution pool agent - iteration 1}
{output of the solution pool agent - iteration 2}
{output of the solution pool agent - iteration 3}
{output of the solution pool agent - iteration 4}
<Strategy-1/>
<Strategy-2: text>
{last full output of the solution pool agent -2}
<Strategy-2/>
<Strategy-3: text>
we don't have pool for the strategy-3 yet and it will be generated just now.
<Strategy-3/>
and so on for strategy-4 and 5.

This is what the Strategy-1 Solution Pool agent will see in the **9th Iteration**:
<Strategy-1: Text>
<MemoryBank For Strategy - 1 Summarizing the past 5 iterations>
<Correction-8>
<Critique for -8>
{output of the solution pool agent - iteration 4}
{output of the solution pool agent - iteration 5}
{output of the solution pool agent - iteration 6}
{output of the solution pool agent - iteration 7}
{last full output of the solution pool agent i.e. iteration 8}
<Strategy-1/>
<Strategy-2: text>
{last full output of the solution pool agent -2 i.e. iteration 8 pool for strategy-2}
<Strategy-2/>
<Strategy-3: text>
{last full output of the solution pool agent -3 i.e. global iteration no 8's pool for strategy-3}
<Strategy-3/>
and so on for strategy-4 and 5.

Hopefully this makes it all clear.

NOTICE HOW WE HAVE MEMORY BANK FOR THE FAILED STRATEGIES TOO BUT WE ARE NOT INSERTING THEM HERE BECUASE THE STRATEGY TEXT WOULD BE LITERALLY DIFFERENT LOL. STRATEGY HAS BEEN UPDATED AND SO SHOWING THE PREVIOUS STRATEGY'S MEMORY WOULD MAKE NO SENSE. THAT'S WHY IT'S CALLED UPDATE.


However, the flaw with this approach is that., for the PQF agent to decide properly whether to keep a strategy or update it., it must see the full correction-critique history of that iteration., without solution pool ofc. PQF doesn't even need to know about Solution Pool.
And since we are doing post quality filter after 5 iterations each, just the history from a single strategy would do worst case of 50k * 2 = 100k tokens.
So, this is what we'd do:
We'd divide the total no of strategies by 2 = N/2
and we'll run N/2 PQF agents in parallel each one receiving 2 strategies = 200k context in worst case.
Each one will only output whether to keep or update the strategies. For context optimization purposes, the PQF agent will just "know" about the other strategies being explored without their full history or anything. Just for psychological effect.
We'll wait for all N/2 PQF agents to output their decision, we can't just contact main strategy generator for each PQF agent. That'd be +N/2 calls again and not efficient. we'll consolidate all N/2 PQF agents output and then make a general request for the main strategy generator to actually provide the updated required strategies.
The main strategy generator agent will have the context about it's previous strategies + their latest execution / correction + their latest critique. This is very important and this is doable.
Yes, for real, I'll repeat again, when called by the PQF agent, the main strategy generator agent will receive
PQF Consolidated Decision Vector (what to keep and update) + All Previous Strategies + Failed Strategies Corresponding Latest Correction + Latest Critique + Their Corresponding Memory Pool (yes, that's why memory pool will run in parallel irrespective of PQF decision. We need Memory Bank from the all strategies and that means even if that strategy will be updated later., because it's crucial for the main generator agent. This "generating memory bank" for all strategies and not just survived strategies might contradict with what i said before but yes this is final)

Notice here, it only receives all previous strategies + ONLY FAILED strategies' latest correction and critique and memory bank.

Ofc., if the strategies are actually updated., and when the next time when we call the main strategy generator agent for updating/evolving the strategies further., it'll receive
PQF Consolidated Decision Vector (what to keep and update) + Original Strategies + New added strategies + (Latest Correction + Latest Critique of all the failed strategies i.e. those strategies that needs update according to PQF now) + corresponding memory pool of those failed strategies.
This is so that the main generator agent doesn't output strategies in iteration 3 that were generated initially (calling that iteration 1) but removed at iteration 2.
This is very important, the entire system relies on the quality of strategies., can't mess up with that.

Yes, if N is odd, like 5 then we have
PQF agent for first 2 strategies, PQF agent for the strategy 3 and 4. and one for strategy 5.


Also, one more thing:
When PQF updates a strategy at Iteration 5, the new branch starts at its own "Iteration 1" while the rest of the system is entering Iteration 6.
The Fix: Yes, we'd artificially update the iteration no of the updated strategy to match the ongoing full system iteration cycle. But it's very important that this update doesn't cause memory bank for the just updated strategy. that's why the MemoryBank trigger must be tied to the strategy's specific age, not the global system iteration number. Strategy 1 gets distilled at Global Iteration 6. The newly updated Strategy 3 will only get distilled at Global Iteration 11 (its 6th iteration).


Crucial, The Memory Bank Agent's Prompt Design:
The distillation agent is now a single point of failure. If it summarizes poorly, iterations 6-10 will repeat the mistakes of 1-5.
The Fix: You must explicitly instruct the Memory Bank Agent not to summarize the solutions, but to summarize the exploration space. Its output must explicitly list:
Validated Invariants: (Things proven mathematically true in this branch).
Dead-Ends: (Approaches/Numbers explicitly tried and refuted by critiques).
Persistent Flaws: (The main critique that the agent hasn't been able to fix yet).
etc. also look at the system prompt for the memory bank agent in the "Contextual Refinements aka Iterative Corrections" application mode. There we have that agent already.


VIMP: Currently we allow the user to whether control PQF would be enabled / disabled. But now it will be by default enabled for the Iterative Corrections Mode (Depth First Search) because we literally cannot move further without this step.
For UI., we don't need to do much changes, just automatically enable it when the iterative corrections mode is ON and allow the user to set the aggressiveness of the PQF agent., ykwim.

--------------------------------

Finally, we have Solution Pool + Hypothesis Consolidation:
IMP: this is optional. User can enable or disable this.

Logic is like this:
If iterative corrections mode = OFF., run the hypothesis exactly as they do rn. Only inject it into execution agents.
If iterative corrections mode = ON., automatically change the injection mode to "Selective" and don't allow user to change to other injection mode.

also don't worry., this isn't going to add more complications. We'd simply append this "selective, strategy-aware" knowledge packets to the solution pool agent's repo or the corrector agent's repo.

currently hypothesis testing can be only injected for the execution agents. Further in the pipeline the knowledge packet is never shared with corrector agent.
the second flaw is that this knowledge packet is extremely static and never updates.
So the goal is to make it extremely flexible and useful even for the correction and solution pool
worst case
6 Hypothesis Testing Total: 50k tokens (Selective Mode. Don't allow other injection mode when iterative corrections enabled)
Thus in worst case a strategy receives 25k Tokens Hypothesis Testing.

This is exactly how it will work:
If iterative corrections mode is ON, then the first iteration of hypothesis generation and testing will happen exactly like how it happens rn. We inject it to the execution agents fine and well.
and since this is in selective mode, it will have strategy-specific context only.
Now we wait for 2 iterations (Note: We injected knowledge packet at iteration 1 i.e. first original execution. and that count as an iteration.)
i.e. Critically, now the first correction agent also gets this exactly strategy-aware specific knoweledge packet that was geenrated initially. So after iteration-2 i.e. when first correction and it's critique is ready., we do this:
1. Call Hypothesis Generation agent with the following context: Provide it with all previous hypothesis with strategy-mapping + each hypothesis testing + + all current strategies + corresponding last 2 correction-critique history from all of them.
   worst case = 50k + 20k * 5 = 150k., basically it is receiving the full knowledge packet that was injected in the initial execution + first correction agent's prompt., plus full latest correction and critique from each strategy.
2. It will now read the pool, and generate new set of hypothesis or updated hypothesis or understand what asking good questions mean in this context, exactly where a given strategy is struggling and exactly what kind of hypothesis might help it. And now it generates a new set of hypothesis (selective i.e strategy aware., but it can change the strategy mapping now., like it doesn't have to worry about that. It can generate new hypothesis with different strategy mapping)
   and that's it. the hypothesis testing agents will work just as they do right now and produce their output. We'd resolve the strategy mapping and see exactly where does the hypothesis generation agent wants the hypothesis-testing-2 and 3 to go i.e. what strategy. Like you know that context aware injection.
3. So the correction agents in the next 2 iterations will receive this updated hypothesis and their testings.
4. Repeat this after every 2 iterations.

This is completely independet of the PQF or Memory Bank., it will run after every 2 global iterations. Just handle the updated strategies correctly. I.e. if the strategies were updated, then provide them to the context not the old strategies. Also add some message that the strategies were updated and new hypothesis might be helpful.


Again, we simply append the strategy-aware packets to the pools of the solution pool and the correction agent.


Flaw: Hypothesis Contamination on Strategy Update (Context Poisoning)

The Scenario:
In Iteration 1, the Hypothesis Generator creates a hypothesis specifically mapped to Strategy 2 (Selective Mode). This packet is heavily utilized in Iterations 2, 3, 4, and 5.
At Iteration 5, PQF kills Strategy 2. The Generator creates a completely new framework (Strategy 2-v2).
The Flaw:
Strategy 2-v2 is a fundamentally different conceptual approach. If we don't clear the Selective Knowledge Packet mapped to "Slot 2", the new Corrector and Pool agents for v2 will receive targeted hypotheses built for the dead strategy. This will severely hallucinate the agents.
The Fix:
When a strategy is marked "Update" and replaced, flush any Selective Hypothesis Packets tied to that strategy slot. The new strategy must operate without hypothesis injection until the next 2-Iteration Hypothesis heartbeat generates fresh, context-aware hypotheses for it.

--------------------------------
Here's the finalized Deepthink Mode Flow. No changes in the flow when sub-strategies enabled (except you can't use red team. and there is a dissected observations agent or all solutions static injection support that should remain there).

When Iterative Corrections Mode is on (Now "Evolving Depth First Search")
Strategies are generated., if  hypothesis are enabled then they are not generated in parallel but rather are generated after the strategies are ready so that the packets can be strategy aware and selective.
We wait for all the hypothesis to be tested, we get the packets and inject them into the resolved strategies execution agents.
Now we start execution agents across each strategy in parallel and then run their critiques.
Code Consistency Decision: It should be preferable if we run the critique for that execution / correction as soon as we get the execution / correction instead of waiting for all executions to complete and then starting all the critiques in parallel... that is not needed here because critiques are independent of any kind of pool. But critiques do have maintained history with themselves and correction agent.

So now we have first execution and critique., we initialize the pool with these (as I exactly mentioned before).
the next call is to solution pool agents, they are all called in parallel across all strategies. 
Now wtf is Initialed Structured Pool Repo? don't overthink or over complicate, remember what was the Solution Pool Repository received by the Solution Pool Agent of strategy-N? it simply received the latest correction + latest critique of that strategy + solution pool history of previous 5 iterations + full pools of all other strategies + selective hypothesis packet for that strategy if hypothesis enabled.

In this case, full pools of all other strategies are simply not ready (they will be generated by each now), we don't have pool history either, we just have latest correction + critique of that strategy. so yes that's perfectly fine. that's indeed the initialized first iteration solution pool repo. We don't need to write complicated code or cases for this. This aligns naturally with our schema. It's dynamic.
So now all the Solution Pool agents will run in parallel and output their corresponding solution pools.

>>>> Now the 1st Global iteration is completed. For the execution, critique and the solution pool. Since we have solution pool agent now (that's the iteration 1 output from the pool agent). Yes, this is literally the most important piece of information in this entire document.

Now we have to start all the correction agents in parallel, remember what their pool schema was? it received past 5 correction-critique history of that strategy + solution pool of that corresponding strategy (we have this ready now) + latest correction-critique from all other strategies + selective hypothesis packet for that strategy if hypothesis enabled.

Now the correction agents will run in parallel, now remember as i said before, we don't need to wait all correction agents output to start the critique. They are independent i.e. critique in Strategy-N doesn't need anything from Strategy-M. But we do need to wait for critiques from all the strategies to finish in order to proceed further. 
These are the "latest correction + latest critique" that i am talking about btw.

Now the next to run in our pipeline flow is Solution Pool agent, now we start all the solution agents in parallel, this time a solution pool agent in a strategy-N receives well latest correction + latest critique inside it's strategy + history of the pools it generated previously for that strategy (history means just last 5) + all other pools (from last iteration) + latest selective knowledge packet for that strategy that our system resolved.
We wait for all the pools to output their solution pool and we are done now.

>> Iteration 2 is completed.
>> Critical, if hypothesis is enabled, then we call hypothesis generation agent, it will generate the hypothesis with the strategy aware selective pattern and then we run the hypothesis testing agents in parallel to get the new (latest) selective strategy aware packet for each strategy.
>> Start the hypothesis generation agents and testing agents at the same time as we start the solution pool agents in parallel.  Because they doesn't receives the pools. So yeah they run in parallel too.
Do we really wait for all the hypothesis testing to complete? Can't we start the correction agents for the next iteration? We cannot. We need to wait. Because the next 2 iterations must receive these knowledge packets. Not the initially generated packets.

Again, very critical piece of information: An ODD iteration is completed if outputs from all the solution pool agents is ready. An EVEN iteration is completed if the output from all the solution pool agents AND output from all the hypothesis testing agents is ready.

Now this repeats.

What happens when 5 iterations are completed?
You know technically an iteration is completed when the output from all solution pool agents from all the strategies is ready.

We have 5 Correction-Critique-SolutionPool Pairs From N strategies. So we kick of Memory Bank agents in parallel across all the strategies.
Memory Bank agent in strategy-1 only receives the full history in the following format
Strategy text
Execution
Critique
Correction
Critique
+ same of 3 more iterations
Critical: It receives only last 5 iterations history of correction and critique in that strategy. It doesn't receive anything from other strategy.


The Scenario:
At Iteration 5, the Memory Bank Agent summarizes Iterations 1–5 for Strategy 1.
At Iteration 10, the system calls the Memory Bank Agent again to distill Iterations 6–10.
The Flaw:
If the Iteration 10 Memory Bank Agent only receives the raw correction/critique history of 6–10, its resulting summary will entirely overwrite the lessons learned in 1–5. By Iteration 11, the Corrector agent will have no idea what was explored in Iterations 1–5.
The Fix (Recursive Distillation):
The Memory Bank Agent must always receive the Previous Memory Bank as part of its prompt.
Prompt: "Here is the Memory Bank summarizing Iterations 1-5. Here is the raw history of Iterations 6-10. Create a unified Memory Bank summarizing Iterations 1-10."



Remember, we have to start N/2 agents + 1 if N is odd. I think this is described using ceiling function: Math.ceil(N / 2)

We don't need to wait for the Memory Banks from all the strategies to finish first in order to kick these (N/2)* Parallel PQF agents. We can kick them in parallel with the memory bank agents. So yeah we do that.
Now we wait for both of them to finish. Yes, literally because the next step is to go to the main strategy generator agent and it needs the full consolidated decision vector of PQF agents + memory banks of the failed strategies.
So yeah, we wait, then go to the main strategy agent (remember what it will receives this time. i already mentioned that), it outputs the updated strategies. We save the old strategies that were marked as "update". This is just for user experience and researchers bro. We can't just overwrite them or delete them. Then we start the new branches for the new strategies (updated strategies)., update their iteration number to global iteration number so that it is consistent with our entire pipeline and the system.
And there we can now start the Iteration 6. the next step will be to call correction agents. again, i have already described in details what they will be receiving. Plus further stuff.
As I said, this is independent of hypothesis generation and testing and so that will run irrespective of our Memory Distillation or PQF. It's just that it controls when the iteration is marked as completed.
Since we'd be doing memory distillation + pqf + strategy update after every 5 iterations, this won't conflict with the hypothesis.

--------------------------------

## Some Final Notes:
- We still keep the max 10 iteration limit on the iterative corrections mode. Also we completely remove the atomic reconstruction bs entirely from our system now. Including UI and prompts. ALso remove the "approach_summary" field completely from it's output schema.
- Sub-strategies currently cannot be enabled in the iterative corrections mode., and it should stay like that. Everything else with sub-strategies enabled should run exactly the same.
- Currently we can run PQF only if iterative correction mode is enabled, and since we have also removed red team now. The sub-strategies doesn't have any red-teaming to them. And that's fine.
- Rename the Iterative Correction Mode to "Evolving Depth First Search" mode., in the UI and logic code.
- Just like how we can currently let the user select the red team to be OFF or balanced or aggressive through UI. we should put same options for the PQF agent too., it's just dynamic system prompt injection so not a big deal.
- I suggest indexing the original execution and critique as Iteration 1. so that we don't have to manually manage them. Yes, the first exexution agent and correction agent are literally different but for the consistency purposes we can do this.
- No change in hypothesis generation, execution and injection. Iterative Corrections mode can still work with hypothesis like it works right now. Only the first execution agent can ever receive that.
- No major change in the system prompt of any agent is needed. Just tell them about the new flow and their revised role. Also we have new Memory Bank agent so it's system prompt should be consistent with the other agents we have in this system.
- Use can still select the depth of the Iterative Corrections Mode. Max = 10 ofc.

UI Changes:
Remove the red team.
Add "Current Memory Bank Card" in the solution pool of each strategy.,
UI indicator for killed strategies and new strategies
Show old hyopthesis cards, Show active hyopthesis cards
Show PQF agents (we have now more than 1)

--------------------------------

## Final Notes For Coding:
- I suggest completely discarding/deleting the old methods, functions and write genuinely professional, high quality, extremely clean and proper code that is scalable
by scalable i mean if we decide to change the max depth from 10 to something else or if we decide to change after how many iterations we stop and call PQF or if we decide to change how many PQF agents attend how many strategies etc things like these.
- Current UI automatically maxes the total no of strategies to 5 when iterative corrections mode is on. You cannot have more than 5 strategies in this mode. It should stay like that. We also automatically disabled the sub-strategies, that should stay like that too.
- Completely remove the user prompt control for all these agents from the prompts manager / customizable prompt. and manage it fully on our own. i.e. don't let the user decide / override that in the prompts manager in the UI. they can still change / play with system prompts.
- For conversation history building don't use any external history manager, since we have extremely strict schema and continuously updating data structures pool for the solution pool and correction agent.
- Yes, for the critique we can use the exact same approach as current. But I'd suggest writing extremely clean, high quality, reusable, DRY principles based abstract and modular code.
- Genuinely do good level of abstraction, modularization and extreme DRY principles for the entire Deepthink Mode. And that includes the sub-strategies = ON mode too.
- Write extremely clear, concise, genuinely professional and consistent code. Don't write stupid stick-tape like laughable stupid code.
- Currently we have extremely poor management of the way we collect other solutions, manage iteration numbers and etc. Like it's really brittle and awful workaround., we need genuinely stable, robust and complete stores., types and stuff like that. You know what i mean. You may need to rewrite the entire deepthink logic files and that's fine with me.
- Do not slice or trim any output from any agent just because I told you about worst case context cases. Do not over engineer or anything. Trust the system.
- Put maximum 15 minutes limit on the output of the following agents:
Execution agent, Critique agent, Solution Pool agent, Memory Bank agent, Hypothesis Generation, Hypothesis Testing agent and Final Judge.
Retry only if failed. Do not just poll retry for no reason. If even on retrying it doesn't finish then skip i.e.say that the output is not available. Do not wait for 15 minutes, then 30 minutes and then 45. Basically yes, there will be a global timer for each agent. Even if they are all started in parallel, they will have their independent timer the time when they were called.
If the initial strategies generation (or main generation for updating strategies) or the PQF fails, we retry it 3 times with exponential back-off like we do rn. If it still fails, then we stop the entire system there. This is an important detail.
-------------------------------------------

