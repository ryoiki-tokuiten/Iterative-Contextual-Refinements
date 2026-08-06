Evolving DFS would be the default and only deepthink mode. Infact, don't even have this concept of "modes" in the deepthink. Completely and fully remove the concept of sub-strategies, dissected observations synthesis and full solution context. This includes everything related to them. Infact, don't even name those functions "EDFS" or anything like that. Keep it clean "Deepthink". This includes removing the system prompt for the sub-strategies generator agent. Do not remove dissected observations synthesis agent: we are gonna integrate it into this new updated flow.

Let
i = total no of iterations (5 < i < 20)
j = no of iterations after which the branches goes through distillation (memory bank i.e. compaction) and strategies are saved/updated(pruning existing branches) (4 <  j < 8)
k = no of iterations after which the custom_curated_context() functions runs i.e. hypothesis refresh heartbeat happens (2 < k < j) with one exception that hypothesis refresh heartbeat will also run after each j even if nk != j. and if infact nk = j, then don't run it twice. run it as usual.
this makes the system extremely flexible and customizable. add this config sliders in the DeepthinkConfigPanel and show a clean direct error based of i j and k config violation on the frontend.
(idk how to use greater than or equal to or less than or equal to symbols but the above inequalities are based off that. i.e. i should be greater than or equal to 5 and less than or equal to 20. same with the j and k conditions I wrote.)
If i = j, then skip the distillation, PQF update and other stuff for the j-th iteration and simply return the current final corrections output from all branches and complete the process by sending this to the final judge. This is so that we don't run distillation memory banks, generate critique correction for updated strategies, run hypothesis and the solution pools and then realize that oh but this was the final iteration, there isn't anything after this.

0. Currently, hypothesis generation agent receives the previous hypothesis history object where it went back and forth with its proximity friend + latest critique + correction from each branch + previous full testing outputs. From now on, it will not receive that full latest critique + correction from all branches. It will still receive the previous hypothesis object + previous heartbeat full testing outputs. Instead, we'd integrate the dissected observations synthesis agent here. It will receive the latest critique + correction from all branches and will generate the informed output and the hypothesis generation agent will receive that.
Dissected Observations Synthesis (DOS) will also be sent to the strategy update agent along with everything that we current send to it.
1. Hypothesis will be always "critique driven" from now on. i.e. don't run the hypothesis on the first iteration which are just strategy aware.
2. Hypothesis can be still disabled. It's just that they will be not generated and tested. Skipped. The system would still run flawlessly without them. Btw, there won't be any modes inside the hypothesis generation now. They will be now always strategy-aware, critique-drived mapped hypothesis. i.e. No full single, programatically concatenated information packet or simply strategy-aware packet. Don't keep backward compatability logic.
3. Solution pools will now not run at every iteration. They are now synced with the hypothesis heartbeat logic. Yes, they now literally  follow on after the hypothesis testing output is ready. Yes, this is a massive change.
4. It is still possible to disable hypothesis and only keep enabled solution pool. or it is still possible to keep the solution pool disabled and only keep the hypothesis enabled. That's why we need a modular function called "curated_context_heartbeat()", it will take parameters like whether hypothesis and solution pool are enabled or not and the value of k and will run the heartbeat after that many iterations. If one of them is disabled then it will simply skip that. In the UI, don't provide duplicate sliders for solution pool and hyopthesis, instead, rename the existing hypothesis config panel UI to "Curated context heartbeat" and there show the slider for k which is general purpose for both hypothesis and solution pool. And inside that allow the user to disable hypothesis or solution pool, if both disabled, then simply collapse the full panel and show that custom curated context is disabled. Hypothesis panel UI in the deepthinkconfigpanel we have already does this literally so you don't need to write anything special.
5. yep, strategy-id = branch-id.
6. Distillation should be handled per branch level, after the strategy update decision is ready. Currently it runs along with the PQF and before the strategy update which is wrong and it won't be like this in the updated flow. If the length of [execution-critique, correction-critique,... ] = j for that branch, then distill it into the memory bank, where a single critique-correction is considered as "1" item in the history length, not "2". If history_len = j, then we'd run distillation irrespective of whether strategy update happened in the global context or not. If there are no branch failures then this should be technically consistent for all the surviving branches and updated branches always.


The Modularity:

1. generate_strategies() function will always, by default run strategy-proximity loop. and their history is always preserved as an object even between various iterations i.e. if the generate_strategies() is called again for strategy update or anything, it will receive all the strategy-proximity loop history so far (from all previous times when it was called) + run this strategy-proximity loop again, return a final strategies object and append the strategy-proximity loop history from current call to the final history so far. Btw, both strategy generator and strategy proximity literally always receive the same deepthink context and history, we are literally changing between their system prompts and output format when we say they go back and forth.

Parameters: no of strategies, strategy-proximity loops, strategy_proximity_so_far(), strategy_agent_context(i)

where strategy_agent_context(i) is a function that returns all the custom deepthink context that our system wants to send to this strategy generator (and it's corresponding proximity agent) for the iteration i. At i = 1 it will be called and will simply receive the original core challenge that's it. But it will be also called at i = jth iteration after distillation and PQF vector for the strategy update, so it will receive necessary context which I will mention below.

Returns: Strategy-Proximity History from this call to append it to the "strategy_proximity_history_so_far"+ Final strategies object.
so technically, strategy_proximity_history_so_far() is managed by this module itself.

2. generate_hypothesis() function will always, by default run hypothesis-proximity loop. and their history is always preserved as an object even between various iterations. When it is called for the next heartbeat, It will be go through the hypothesis-proximity loop, generate its own history block for this heatbeat and we'd simply append that to the final history so far. outputs a final strategy-aware hypothesis object. Similarly, hypothesis generation and hypothesis proximity both receive the same deepthink context and history. We are changing between the system prompt only.

Parameters: No of hypothesis to generate, hypothesis-proximity loops, hypothesis_proximity_history_so_far, hypothesis_agent_context(i)

Returns: hypothesis proximity history from this call to append it to so far history + final hypothesis object.

3. test_hypothesis() runs immediately on the final hypothesis object by starting m hypothesis testing agents in parallel each one receiving their hypothesis.

Parameters: hypothesis_object (with mapping). that's it. yep. this is extremely focused module. we don't even have custom curated context for this.

Returns: the final testing outputs +  our system should take these testing outputs + strategy aware decisions inside the corresponding hypothesis object and build strategy-aware packets i.e. what hypothesis + corresponding testing should be sent to what branch. Mapping. So technically, it should return the mapped testing outputs. keep both. So yeah, return this not the full final testing outputs concatenated. We don't need that. Don't keep any backward compatability.

4. generate_solution_pool(): runs per branch. each one receives its custom curated context according to our solution pool context logic for branch and iteration no + mapped strategy-aware hypothesis testing packets for that branch.

Parameters: iteration no, context_solution_pool(), 
returns: JSON-format solution pool for each branch. 

5. curated_context_heartbeat(i, j):
actually runs the "heartbeat" if hypothesis or solution pool is enabled.
Default: runs hypothesis_generation()  > test_hypothesis() > generate_solution_pool().
Only hypothesis is enabled: runs hypothesis_heartbeat(): hypothesis_generation > test_hypothesis
Only solution pool is enabled: runs generate_solution_pool simply.
Both are disabled: skip both. nothing happens. simply whatever the next thing in the deepthink was waiting after this is initiated.

once the hypothesis generation + testing is finished it returns: hypothesis_testing_packets mapped to their corresponding branches so that it can be used for the next immediate solution pool run. call this "hypothesis_testing_mapped(branch-id)", it is genuinely very useful and might be needed again. we then wait for all the solution pools from all the branches
then finally return: mapped hypothesis testing packets + solution pool output for each branch.

So yes, we should ready-made this function called "latest_custom_curated_context(j, branch-id)". where we map the hypothesis + hypothesis testing for that branch ID + the corresponding solution pool for that branch ID. this is final return value.

these are the modules that builds the custom curated context for the deepthink flow:

6. context_solution_pool(i, custom_curated_context_heartbeat_no): 

builds context for the solution pool agent for the iteration i

return: assigned strategy-ID + it's text + latest correction and critique from that branch (this is i-th iteration output of those agents btw) + all previous pool history from previous heartbeats for that branch + cross_strategy_latest_pools(!branch-id, j) + hypothesis_testing_mapped(branch-id, i)

7. cross_strategy_latest_correction_critique(!branch-id, i): should return the latest (i-1 th iteration) correction + critique from all the other branches except the "branch-id". this is peak. we should literally do it this way.
Format:
strategy-id-1: strategy_text + i-1th correction + i-1th critique
strategy-id-2: same
...

8. cross_strategy_latest_pools(!branch-id, j): should return the latest (j-1 th iteration) pools from all the other branches except the "branch-id".
If branch isolation is enabled, then simply return null for 7 and 8. Peak.

9. critique_correction_memory_bank_history(branch-id, i,j):
builds a clean history object for the critique and correction agents for the given branch.
A BRANCH IS DISTILLED IF THE LENGTH OF THE HISTORY OBJECT = J,
branch just went through distillation: memory bank for that branch + latest correction-critique for that branch.
branch went through distillation and more iterations have passed (like j-1 or j-2): memory bank + history of correction-critique after the distillation (includes the latest correction and critique)
branch went through another distillation: latest memory bank + latest correction-critique for that branch.

9. context_for_correction_agent(assigned_branch_id, i, latest_custom_curated_context_heartbeat(j, branch-id)):
this builds context for the correction-agent for the i-th iteration.
Since literally the same pattern is repeated inside the context_critique(same-branch-id) too (as the critique agent receive the same context), I'd suggest building another module that handles this: critique_correction_memory_bank_history(i, j). This is independent of other branches.

Return:
critique_correction_memory_bank_history(i,j, branch-id) + latest_custom_curated_context_heartbeat(j, branch-id) + cross_strategy_latest_correction_critique(!branch-id).


8. context_for_critique_agent(assigned_branch_id, i): 
receives critique_correction_memory_bank_history(i-1) + latest correction and returns a critique for iteration i.

A very important distinction:
critique_correction_memory_bank_history(i) includes the context from (i-1) iterations and it includes the critique that the correction agent in the i-th iteration needs. However, the critique_correction_memory_bank_history(i) that critique agent receives at the i-th iteration doesn't include the immediate correction output produced in the i-th iteration itself.

8. context_pqf(assigned_branch_ids, i): 
9. context_strategy_generate():
10. context_hypothesis_generate():
11. context_critique(assigned_branch_id, i):
12. context_memory_bank(assigned_branch_id):
13. context_
 
 
 
The unified/only flow:
1. Generate N strategies (automatically I assume it'd go through strategy-proximity loop and returns the final strategies).
2. Execute each branch in parallel [Execution > Critique]. Wait until all the branches are ready.
3. 






> User should be still able to disable hypothesis completely, or disable solution pool or isolate branches.

--------------


For prompts:

PQF logic should be based off information-theory and delta changes. We compute the information gain between iteration t and iteration t-1. If the mutual information between the two corrections is nearly 100% (i.e. information gain ~ 0), the pqf prunes the branch.

RIMRULE paper tried this: If an agent fails at a task, collect the failure traces and instead of passing the raw trace to the next agent, use an MDL objective (minimum description length) to force the LLM to propose a generalized, compact rule. It mathematically favors conciseness and generality. Compressed rule is then injected into the prompt for future runs, significantly improving the tool-use accuracy without blowing up the context window (they tried it on tool usage failure traces).

Could be a useful component to this system (standford paper):
It is "Entropy-Governed Multi-Agent Debate." It quantitatively modulates dialogue via information theory. Instead of a fixed number of debate rounds, the framework measures the entropy of the agent pool. When the variance (entropy) of the proposed solutions collapses below a certain threshold, the system knows convergence has been reached and terminates the loop, saving massive amounts of compute.

One more:
The Research: A 2026 paper, Understanding Reasoning in LLMs through Strategic Information Allocation under Uncertainty, models this as "silent divergence".

How it works: They proved that standard LLMs fail to allocate information correctly when uncertainty rises. They built an information-theoretic framework that forces the LLM to output "epistemic verbalization" (explicitly generating doubt cues like "Wait, is this correct?" as tokens). By forcing the model to externalize its internal uncertainty distribution into the context window, it recovered 15% of failed reasoning trajectories.

In your system: Your Solution Pool injecting "structured noise" acts as external epistemic verbalization. It forcibly alters the context distribution, preventing the correction agent from silently diverging down a confident-but-wrong path.
