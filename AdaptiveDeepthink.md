Current adaptive deepthink mode is very proto-typish and not well thought. So we are going to completely revamp it.
1. UI is not connected with the deepthink live tab.
2. Not connected with virtual environment tool and thus filemanager UI.


Orchestrator agent nature now:
0. aggresive, exploratory and divergent by design. Don't just easily save strategies. Be very mindful about the critique and immediate correction. By first pass, it will have probably the best possible first pass output for that certain problem or idea implementation. But the entire point of strategic branches is to be explorative, orthogonal, independent and divergent. This is by cognitive design.
1. obsessively iterate on the strategies generation /  hypothesis generation themselves. Obsessively until we have cross-domain connections, structural flaws, etc.
2. ability to save a given strategy/hypothesis. discard previously generated ones completely.
3. critique & correction response in-built with execution. literally. single tool call handle both. there is no separate call for critique or correction.
4. no more than 5 strategies or hypothesis at a time. this is a global limit.
5. does not proceed blindly and get satisfied . and there's no limit on the no of passes.


new agents: 
strategies proximity
hypothesis proximity

total agents:
import from deepthink.
1. Strategies Generator + Strategies Proximity
2. Hypothesis Generator + Hypothesis Proximity
3. Test Hypothesis
4. Execution + Critique + Corrector


tools:
generate_strategies()
generate_hypothesis()
execute(), also allow the orchestrator to pass custom message to each strategy execution branch. "specialContext" babe.
save(strategy-id(s))
finalize_pass_and_execute("same parameters as execute("") tool"): automatically update the context (replace with the links) + run execute() tool with the custom parameters if any.
read_files() -- for reading the auto-compacted context into file links from previous passes.
virtual_environment() -- the same backend based bash environment that we give to the current deepthink and contextual mode

when enabled, all the deepthink agents will have access to virtual environment too with the same persmissions that we give in the current deepthink mode, including the submit final output, because essentially that's what the orchestrator will receive from that agent. The orchestrator agent will have root read and write access to the global repository. Ofc, the orchestrator receives the submit final output tool, but it will use that to submit the final judged answer. Currently, adaptive deepthink mode literally calls a judge (final_judge tool) to judge the best solutions lol. now the orchestrator does that directly.


Important: Same file system permissions for the strategy generator (and strategies proximity), hypothesis generator (and hypothesis proximity), hyopthesis execution, execution, critique and correction all these agents will have same permissions as the original deepthink mode have it.

---

Updated Flow:
`generate_strategies()`: strategy generation > proximity agent > update strategies > proximity (back and forth 3 times, if proximity still asks for update after 3 back and forth iterations, then take the latest current strategies from their back and forth conversation)

>> even after proximity check, orchestrator can deicde to ignore certain strategies or hypothesis like maybe duplication checks, sanity checks etc. No separate tool needed because execute() is literally parameter based that takes both strategies IDs and selective hypothesis context for each.

`execute()`: parallel, single tool call does the following (3 agents calls per strategy):
Strategy > Execution > Critique > Correction
Strategy > Execution > Critique > Correction
...

worst case context: 25k * 5 = 125k. Can't always give to orchestrator. But we give it fully to orchestrator each time. But replace it with a "Pass-01-S1-Execution.md", "Pass-01-S2-Execution.md" and so on. So yes, orchestrator has read_file() tool too.

>> separate tool: save(strategy-ids). save certain strategies permanently. based on the degree of a critique & correction in each. we never further ever consider this strategy, or it's execution or critique. this strategy is saved. it can't be updated / replaced. only the unsaved can be replaced (updated) or new can be added. this strategy number is literally reserved and permanently saved.



`generate_hypothesis()`: these are never generated blindly., not even strategy aware. these are critique based hypothesis only. and btw now it doesn't do strategy and knowledge packet resolving either.
give them latest
{[Execution-Critique], [Execution-Critique]..., [Execution-Critique]} + orchestrator's message if any. Notice how they don't receive the corrections.
hypothesis generation > proximity > update_hypothesis > proximity > update hypothesis (max 3, fallback to latest).
take the latest hypothesis, and then call test_hypothesis on each. take all hypothesis testing output as it is and give it to the orchestrator.
running worst case for the orchestrator agent: 125k + 10k*6 = 185k, Okay. But we replace it with appropriate file names links after the pass is completed.


after the hypothesis packet is ready:
execute({strategy-2, context: h-2, h-3}, {strategy-3, context: h-1, h-2})

!! Important: how would our system know when the Pass-N is done?
finalize_pass_and_execute() will automatically mark a given pass as done, then update the context (replace with the links) + run execute() tool with the custom parameters by the orchestrator if any.


this time though, each strategy execution goes like this:
It receives: Strategy > Original Execution > Critique > Critique Based Hypothesis Testing Context (except critique agents). Notice how it doesn't receives the correction from previous pass.
Output agent chain: Execution > Critique > Correction.

Important detail: critique agents don't receive the hypothesis context. So we are not running the execution > critique > correction with a sliding system prompt. It's managed independently cleanly. also we can't just keep history for them lol. because in the next pass we don't pass the full history.


So now each strategy produces each of these blocks. orchestrator receives these blocks with their complete content. it can again decide to save certain. or try again with new updated hypothesis.

generate_hypothesis() this time:
Just like strategy and strategy-proximity, keep the history block between hypothesis generation and hypothesis proximity as it is.
+ orchestrator's message: doesn't have to output the same no of hypothesis. can re-test hypothesis. generate new replacements if needed. there's no mechanism to save hypothesis. if it skips, then it's gone. only what's generated at each step is carried forward. previous hypotheses and their testing is now completely gon (important decision).
+ latest {[Execution-Critique], [Execution-Critique]..., [Execution-Critique]}.


after 3-4 pass, if no progress, then it goes to the update strategies.
update_strategies(): 
>>  Same flow as original i.e. strategy generation > proximity agent > update strategies > proximity back and forth. The only difference is that this time they will receive orchestrator's message about failing paths, what strategies it has saved and what needs update.
>> Instead of keeping a history of all strategies considered so far: pruned/ongoing. Store the history object between the strategy generator and proximity agent. Ony update the system prompt back and forth. Storing the history object automatically contains the previous strategies by definition.
>> Output like ({S3:...}, {S5:...}), assuming s1 and s2 were saved and orchestrator said that it will iterate more on S4 by giving it more time. and orchestrator asked for update instead of new.


---

>> Hypothesis missing corrections is intentional because this is literally the job of orchestrator. Orchestrator reads the execution output blocks with the correction output as well and it literally saves certain strategies because their correction correctly respected the critique and steered accordingly. Because think about this, if the critique was fully respected and the correction was correctlly steered in that direction, what's the point of iterating that execution again?. That's literally why we have save strategy ids tool. Only the remaining strategies are processed later, and so the hypothesis generation agent seeing the execution-critique blocks only (not seeing correction blocks) is meaningful. Because the corresponding corrections of these are already marked as something that weren't followed enough. If the hypotheiss generation agent sees the correction output, then it might try to produce local hypothesis that tries to locally help the corrector. Thus overall system stucking in local minima.

>> Critique agents missing hypothesis context is also intentional because it has to be highly highly focused. This is just based off my experience building lots of scaffolds and harnesses. Same goes with the hypothesis testing agent, it does't receive the critique or history of any execution or whatever. These 2 agents are highly focused.

----------


Most important thing wrt iterations and pass:
Suppose a correction agent wrote some file inside it's strategy directory, but the orchestrator decides to iterate on this strategy further. Do you know what this automatically means?, it means that the previous correction output (including the files it created and everything) is now completely useless and disregarded. Nobody knows where they came from. Because the later iterations don't receive the correction output from previous iteration. We literally are removing it and that's the point of this entire system. Same with the execution and critique agents i.e. Because in the next pass, we literally have a new fresh execution and critique from the previous pass.

So how do we solve this?
we take a git snapshot of that strategy directory before spawning the correction agent, the strategy that we are iterating (not the strategies that are saved permanently). So in the next pass, we simply give all repo access, the same strategy directory, the only difference would be that the strategy directory would be the one that we snapshotted before the correction agent was used in the previous pass. We do that in each pass. If the strategy is saved by the orchestrator, then that's saved with the correction output as well.


Just like the deepthink mode, also store the full outputs of the agents in the .md file and their trace in the JSON file.


>> Write extremely detailed system prompt for the orchestrator. Literally almost as detailed as this current document plan lol. It is very very important that it understands all the details and internalize it.